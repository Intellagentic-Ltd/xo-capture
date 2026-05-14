"""
XO Platform — Shared Integrations Config

Account-scoped credential storage for Salesforce and Gong integrations,
plus OAuth state nonce management.

ARCHITECTURE
- Account-level (team model): stored in system_config with account_id = <int>.
- Per-client override (partner model): stored in client_integrations columns.
- HubSpot is GLOBAL (account_id IS NULL) and does NOT route through this
  module — its own _get_config/_set_config in hubspot-sync/lambda_function.py
  continue to read/write the unscoped row. See _run_integrations_migration
  in clients/lambda_function.py for the rationale.

CALLER CONTRACT
- account_id is required (int) for every function here. NULL account_id is
  reserved for HubSpot's legacy path; passing None will raise.
- Encryption uses the master key via crypto_helper.encrypt / decrypt.

CONFIG_KEY NAMESPACE CONTRACT
  hubspot_*    → account_id IS NULL  (Intellagentic-only, global)
  salesforce_* → account_id IS NOT NULL (per-account)
  gong_*       → account_id IS NOT NULL (per-account)
Cross-namespace collisions are forbidden. Adding a new integration MUST
pick a unique prefix and scope its rows by account_id. This invariant is
what keeps hubspot-sync's unscoped _get_config safe — its 'hubspot_*'
keys cannot be shadowed by an account-scoped row written through this
module.
"""

import os
import json
import base64
import secrets
import logging
from datetime import datetime, timezone, timedelta

from crypto_helper import encrypt, decrypt

logger = logging.getLogger('xo.integrations')
logger.setLevel(logging.INFO)


# ──────────────────────────────────────────────
# Account-level config (system_config, account_id-scoped)
# ──────────────────────────────────────────────

def _require_account_id(account_id):
    if account_id is None:
        raise ValueError(
            "account_id is required. NULL account_id is reserved for HubSpot's "
            "legacy unscoped path; use hubspot-sync._get_config/_set_config instead."
        )


def set_account_config(conn, account_id, key, value):
    """Encrypt value with master key and upsert into account-scoped system_config."""
    _require_account_id(account_id)
    encrypted = encrypt(value) if value is not None else None
    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO system_config (account_id, config_key, config_value, updated_at)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (account_id, config_key) DO UPDATE
                SET config_value = EXCLUDED.config_value,
                    updated_at = NOW()
            """,
            (account_id, key, encrypted),
        )
        conn.commit()
    finally:
        cur.close()


def get_account_config(conn, account_id, key):
    """Read and decrypt an account-scoped config value. Returns None if absent."""
    _require_account_id(account_id)
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT config_value FROM system_config "
            "WHERE account_id = %s AND config_key = %s",
            (account_id, key),
        )
        row = cur.fetchone()
    finally:
        cur.close()
    if not row or row[0] is None:
        return None
    return decrypt(row[0])


def delete_account_config(conn, account_id, key):
    """Remove an account-scoped config row (for disconnect flow)."""
    _require_account_id(account_id)
    cur = conn.cursor()
    try:
        cur.execute(
            "DELETE FROM system_config WHERE account_id = %s AND config_key = %s",
            (account_id, key),
        )
        conn.commit()
    finally:
        cur.close()


# ──────────────────────────────────────────────
# Client-level integration overrides (client_integrations table)
# ──────────────────────────────────────────────

_INTEGRATION_FIELDS = {
    'salesforce': {
        'plain': ['salesforce_instance_url', 'salesforce_token_expiry',
                  'salesforce_connected_by', 'salesforce_connected_at'],
        'encrypted': ['salesforce_access_token_encrypted',
                      'salesforce_refresh_token_encrypted'],
    },
    'gong': {
        'plain': ['gong_workspace_id', 'gong_connected_by', 'gong_connected_at'],
        'encrypted': ['gong_access_key_encrypted',
                      'gong_access_key_secret_encrypted',
                      'gong_webhook_secret_encrypted'],
    },
}


def get_client_integration(conn, client_id, integration):
    """
    Read per-client integration overrides. Returns a dict with decrypted secrets,
    or None if no row exists or all integration-specific columns are NULL.

    Result keys match column names with '_encrypted' suffix stripped from secrets.
    """
    if integration not in _INTEGRATION_FIELDS:
        raise ValueError(f"Unknown integration: {integration}")

    fields = _INTEGRATION_FIELDS[integration]
    all_cols = fields['plain'] + fields['encrypted']
    select_list = ', '.join(all_cols)

    cur = conn.cursor()
    try:
        cur.execute(
            f"SELECT {select_list} FROM client_integrations WHERE client_id = %s",
            (client_id,),
        )
        row = cur.fetchone()
    finally:
        cur.close()

    if not row or all(v is None for v in row):
        return None

    result = {}
    for col, val in zip(all_cols, row):
        if col in fields['encrypted']:
            # Strip _encrypted suffix in the returned dict — callers want
            # 'salesforce_access_token', not 'salesforce_access_token_encrypted'.
            clean_key = col[:-len('_encrypted')]
            result[clean_key] = decrypt(val) if val is not None else None
        else:
            result[col] = val
    return result


def resolve_integration_config(conn, client_id, integration, account_id):
    """
    Partner-first resolution: returns client_integrations row if present,
    else falls back to account-level system_config.

    Account-level fallback returns a dict shaped like get_client_integration,
    built by reading individual config_keys.
    """
    client_level = get_client_integration(conn, client_id, integration)
    if client_level:
        return client_level

    # Fall back to account-level system_config.
    _require_account_id(account_id)
    if integration == 'salesforce':
        keys = {
            'salesforce_instance_url': 'salesforce_instance_url',
            'salesforce_access_token': 'salesforce_access_token',
            'salesforce_refresh_token': 'salesforce_refresh_token',
            'salesforce_token_expiry': 'salesforce_token_expiry',
        }
    elif integration == 'gong':
        keys = {
            'gong_workspace_id': 'gong_workspace_id',
            'gong_access_key': 'gong_access_key',
            'gong_access_key_secret': 'gong_access_key_secret',
            'gong_webhook_secret': 'gong_webhook_secret',
        }
    else:
        raise ValueError(f"Unknown integration: {integration}")

    result = {k: get_account_config(conn, account_id, v) for k, v in keys.items()}
    if all(v is None for v in result.values()):
        return None
    return result


# ──────────────────────────────────────────────
# OAuth state nonces (CSRF defense for /connect → /callback flow)
# ──────────────────────────────────────────────

NONCE_TTL_MINUTES = 10  # Enterprise SSO + MFA can exceed 5 min (hardware keys, etc.)


def create_oauth_nonce(conn, account_id, user_id, integration, client_id=None,
                       ttl_minutes=NONCE_TTL_MINUTES):
    """
    Mint a single-use OAuth state nonce. Returns the nonce string to embed
    in the OAuth authorize URL's state= parameter.

    Opportunistically prunes expired rows.
    """
    _require_account_id(account_id)
    if integration not in ('salesforce', 'gong'):
        raise ValueError(f"Unknown integration: {integration}")

    nonce = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes)

    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM oauth_state_nonces WHERE expires_at < NOW()")
        cur.execute(
            """
            INSERT INTO oauth_state_nonces
                (nonce, account_id, client_id, user_id, integration, expires_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (nonce, account_id, client_id, user_id, integration, expires_at),
        )
        conn.commit()
    finally:
        cur.close()
    return nonce


def consume_oauth_nonce(conn, nonce):
    """
    Verify and consume a nonce. Returns a dict with account_id, client_id,
    user_id, integration on success, or None if the nonce is unknown or expired.

    The row is deleted on consumption (single-use), even if expired.
    """
    cur = conn.cursor()
    try:
        cur.execute(
            """
            DELETE FROM oauth_state_nonces
            WHERE nonce = %s
            RETURNING account_id, client_id, user_id, integration, expires_at
            """,
            (nonce,),
        )
        row = cur.fetchone()
        conn.commit()
    finally:
        cur.close()

    if not row:
        return None
    account_id, client_id, user_id, integration, expires_at = row
    # Postgres returns timezone-aware datetimes for `TIMESTAMP WITH TIME ZONE`.
    if expires_at < datetime.now(timezone.utc):
        logger.info("oauth nonce expired on consume: integration=%s", integration)
        return None
    return {
        'account_id': account_id,
        'client_id': client_id,
        'user_id': str(user_id) if user_id else None,
        'integration': integration,
    }
