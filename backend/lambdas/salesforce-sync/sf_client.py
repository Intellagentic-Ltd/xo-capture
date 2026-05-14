"""
XO Platform — Salesforce HTTP + token helpers.

Extracted from lambda_function.py in PR 3 so the pull path (sf_pull.py)
and the Outbound Message webhook (sf_webhook.py) can share the same
session/refresh machinery as the push path.

Module surface:
  - sf_request: single SF REST call.
  - sf_call_with_refresh: same, but transparently refreshes on 401 and
    retries once. New access token persists scoped to account_id.
  - exchange_code_for_tokens / refresh_access_token: OAuth grants.
  - read_account_tokens / write_account_tokens: encrypted token storage
    against system_config via integrations_config (account_id-scoped;
    HubSpot's NULL-account namespace is intentionally unreachable).
  - soql_escape: safe SOQL string literal escape.

Test patching:
  Tests should patch `sf_client.requests` (not `lambda_function.requests`)
  to control SF HTTP calls. This is where every requests.* call lives.
"""

import os
import logging

import requests

from integrations_config import set_account_config, get_account_config

logger = logging.getLogger('xo.salesforce.client')
logger.setLevel(logging.INFO)

SALESFORCE_CLIENT_ID = os.environ.get('SALESFORCE_CLIENT_ID', '')
SALESFORCE_CLIENT_SECRET = os.environ.get('SALESFORCE_CLIENT_SECRET', '')
SALESFORCE_REDIRECT_URI = os.environ.get('SALESFORCE_REDIRECT_URI', '')
SALESFORCE_LOGIN_URL = os.environ.get('SALESFORCE_LOGIN_URL', 'https://login.salesforce.com')
SF_API_VERSION = os.environ.get('SALESFORCE_API_VERSION', 'v59.0')


# ──────────────────────────────────────────────
# SOQL utility
# ──────────────────────────────────────────────
def soql_escape(s):
    """Escape single quotes and backslashes for SOQL string literals."""
    if s is None:
        return ''
    return s.replace('\\', '\\\\').replace("'", "\\'")


# ──────────────────────────────────────────────
# REST + OAuth
# ──────────────────────────────────────────────
def sf_request(method, instance_url, path, access_token, json_body=None, params=None):
    """Single SF REST call. Returns (status_code, body_dict)."""
    url = f"{instance_url}/services/data/{SF_API_VERSION}{path}"
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json',
    }
    resp = requests.request(method, url, headers=headers, json=json_body,
                            params=params, timeout=30)
    try:
        body = resp.json()
    except ValueError:
        body = {'_raw': resp.text}
    return resp.status_code, body


def exchange_code_for_tokens(code):
    """OAuth authorization_code grant. Returns (status, body)."""
    resp = requests.post(
        f"{SALESFORCE_LOGIN_URL}/services/oauth2/token",
        data={
            'grant_type': 'authorization_code',
            'code': code,
            'client_id': SALESFORCE_CLIENT_ID,
            'client_secret': SALESFORCE_CLIENT_SECRET,
            'redirect_uri': SALESFORCE_REDIRECT_URI,
        },
        timeout=30,
    )
    try:
        body = resp.json()
    except ValueError:
        body = {'error': 'invalid_response', '_raw': resp.text}
    return resp.status_code, body


def refresh_access_token(refresh_token):
    """OAuth refresh_token grant. Returns (status, body)."""
    resp = requests.post(
        f"{SALESFORCE_LOGIN_URL}/services/oauth2/token",
        data={
            'grant_type': 'refresh_token',
            'refresh_token': refresh_token,
            'client_id': SALESFORCE_CLIENT_ID,
            'client_secret': SALESFORCE_CLIENT_SECRET,
        },
        timeout=30,
    )
    try:
        body = resp.json()
    except ValueError:
        body = {'error': 'invalid_response', '_raw': resp.text}
    return resp.status_code, body


def fetch_org_id(access_token, instance_url):
    """Fetch the Organization Id for this access token's org.

    Used by the Outbound Message webhook for first-time org_id caching.
    Hits /services/oauth2/userinfo, which is cheap and doesn't require
    a Bulk API license. Returns the org_id string, or None on failure.
    """
    resp = requests.get(
        f"{instance_url}/services/oauth2/userinfo",
        headers={'Authorization': f'Bearer {access_token}'},
        timeout=30,
    )
    if resp.status_code != 200:
        logger.warning("fetch_org_id: userinfo returned status=%s", resp.status_code)
        return None
    try:
        body = resp.json()
    except ValueError:
        return None
    return body.get('organization_id')


# ──────────────────────────────────────────────
# Token storage (account-scoped via integrations_config)
# ──────────────────────────────────────────────
def read_account_tokens(conn, account_id):
    """Read decrypted SF tokens for account_id. Returns dict or None if not connected.

    account_id MUST come from the JWT (or the consumed OAuth nonce on
    callback) — never from a client-supplied value.
    """
    access = get_account_config(conn, account_id, 'salesforce_access_token')
    refresh = get_account_config(conn, account_id, 'salesforce_refresh_token')
    instance_url = get_account_config(conn, account_id, 'salesforce_instance_url')
    if not (access and refresh and instance_url):
        return None
    return {
        'access_token': access,
        'refresh_token': refresh,
        'instance_url': instance_url,
    }


def write_account_tokens(conn, account_id, access, refresh, instance_url):
    """Persist tokens via integrations_config (master-key encrypted)."""
    set_account_config(conn, account_id, 'salesforce_access_token', access)
    if refresh:
        set_account_config(conn, account_id, 'salesforce_refresh_token', refresh)
    set_account_config(conn, account_id, 'salesforce_instance_url', instance_url)


# ──────────────────────────────────────────────
# SF call with reactive token refresh
# ──────────────────────────────────────────────
def sf_call_with_refresh(conn, account_id, tokens, method, path,
                         json_body=None, params=None):
    """Call SF API; on 401, refresh once and retry.

    SF session timeouts are org-configurable (15 min to 8 hours), so we
    react to 401 rather than tracking expiry. `tokens` dict is mutated
    in place when refresh succeeds so callers see the new access_token.
    """
    status, body = sf_request(
        method, tokens['instance_url'], path, tokens['access_token'],
        json_body=json_body, params=params,
    )
    if status != 401:
        return status, body

    rstatus, rbody = refresh_access_token(tokens['refresh_token'])
    if rstatus != 200 or 'access_token' not in rbody:
        logger.warning("SF token refresh failed: status=%s body=%s", rstatus, rbody)
        return status, body  # surface original 401

    tokens['access_token'] = rbody['access_token']
    if rbody.get('instance_url'):
        tokens['instance_url'] = rbody['instance_url']
    write_account_tokens(
        conn, account_id, tokens['access_token'], None, tokens['instance_url']
    )

    # Retry once with the new token.
    return sf_request(
        method, tokens['instance_url'], path, tokens['access_token'],
        json_body=json_body, params=params,
    )
