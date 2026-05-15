"""
XO Platform — Salesforce Sync Lambda (PR 2 / Stage 1a)

Scope of this lambda (PR 2):
  - OAuth connect/callback with nonce-based state (CSRF defense via
    shared/integrations_config.create_oauth_nonce / consume_oauth_nonce).
    Single-use, 10-minute TTL — enforced in the shared helper.
  - Standard-field push only: Account.Description + Task on Account.
    NO Metadata API custom-field auto-provision (deferred to a future
    AppExchange package; commercial decision documented in PR 1).
  - Team model only (account-level credentials in system_config via
    integrations_config). Partner-model per-client connections land in
    PR 4.

Out of scope for PR 2 (do NOT add here — will land in subsequent PRs):
  - /salesforce/sync/pull and Outbound Message webhook → PR 3
  - Per-client connect via client_integrations → PR 4
  - Frontend admin UI (connect button, conflict resolver) → PR 4
  - Conflict resolution and field-mapping endpoints → PR 4
  - Salesforce → XO contact pull → PR 3

CONFIG_KEY NAMESPACE (from PR 1 contract):
  All keys this lambda reads/writes are prefixed `salesforce_*` and live
  in system_config with account_id IS NOT NULL. HubSpot keeps its
  separate `hubspot_*` / account_id IS NULL row in the same table.
"""

import json
import logging
from datetime import datetime, timezone
from urllib.parse import urlencode

from auth_helper import (
    require_auth, get_db_connection, log_activity, CORS_HEADERS,
)
from integrations_config import (
    delete_account_config,
    create_oauth_nonce, consume_oauth_nonce,
)
from sf_client import (
    SALESFORCE_CLIENT_ID, SALESFORCE_REDIRECT_URI, SALESFORCE_LOGIN_URL,
    soql_escape, sf_call_with_refresh, exchange_code_for_tokens,
    read_account_tokens, write_account_tokens,
)
from sf_pull import pull_accounts
from sf_contact_pull import pull_contacts
from sf_opportunity_pull import pull_opportunities
from sf_webhook import handle_outbound_message
from client_access import can_user_access_client

logger = logging.getLogger('xo.salesforce')
logger.setLevel(logging.INFO)


# ──────────────────────────────────────────────
# Cold-start schema migration (PR 2 columns + sync log table).
# system_config / client_integrations / oauth_state_nonces already exist
# from PR 1 — those are owned by clients/lambda_function.py.
# ──────────────────────────────────────────────
def _run_salesforce_migrations():
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # PR 2 / 3 / 3.5 schema, idempotent at every cold start.
        cur.execute(
            "ALTER TABLE engagements ADD COLUMN IF NOT EXISTS salesforce_task_id VARCHAR(18)"
        )
        cur.execute(
            "ALTER TABLE engagements ADD COLUMN IF NOT EXISTS salesforce_synced_at TIMESTAMP WITH TIME ZONE"
        )

        # PR 3.5: Opportunity reconciliation needs salesforce_opportunity_id on
        # engagements (separate from salesforce_task_id which sf push uses for
        # the activity record). Plus the standard Opportunity fields the pull
        # path mirrors back into the engagement row.
        cur.execute(
            "ALTER TABLE engagements ADD COLUMN IF NOT EXISTS salesforce_opportunity_id VARCHAR(18)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_engagements_sf_opportunity "
            "ON engagements(salesforce_opportunity_id)"
        )
        cur.execute("ALTER TABLE engagements ADD COLUMN IF NOT EXISTS stage VARCHAR(80)")
        cur.execute("ALTER TABLE engagements ADD COLUMN IF NOT EXISTS amount NUMERIC(18,2)")
        cur.execute("ALTER TABLE engagements ADD COLUMN IF NOT EXISTS close_date DATE")
        cur.execute("ALTER TABLE engagements ADD COLUMN IF NOT EXISTS description TEXT")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS salesforce_sync_log (
                id SERIAL PRIMARY KEY,
                account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
                record_type VARCHAR(20) NOT NULL,
                record_id UUID,
                salesforce_id VARCHAR(18),
                sync_direction VARCHAR(10) NOT NULL,
                fields_updated TEXT,
                fields_skipped TEXT,
                details TEXT,
                synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """)
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_sf_sync_log_account "
            "ON salesforce_sync_log(account_id)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_sf_sync_log_record "
            "ON salesforce_sync_log(record_type, record_id)"
        )

        # PR 3.5: drop the legacy clients.salesforce_account_id and
        # salesforce_last_sync columns. SF mapping moved to
        # client_salesforce_links (per-tenant, owned by clients lambda from
        # PR 3.4). idx_clients_sf_account is dropped automatically when its
        # column drops; DROP INDEX IF EXISTS handles re-run.
        cur.execute("DROP INDEX IF EXISTS idx_clients_sf_account")
        cur.execute("ALTER TABLE clients DROP COLUMN IF EXISTS salesforce_account_id")
        cur.execute("ALTER TABLE clients DROP COLUMN IF EXISTS salesforce_last_sync")

        conn.commit()
        cur.close()
        conn.close()
        print("Salesforce migration complete: engagements.salesforce_opportunity_id added; "
              "legacy clients SF columns dropped; sync log + indexes ensured.")
    except Exception as e:
        print(f"Salesforce migration check (non-fatal): {e}")


_run_salesforce_migrations()


# ──────────────────────────────────────────────
# Response helpers
# ──────────────────────────────────────────────
def _err(status, msg):
    return {
        'statusCode': status,
        'headers': CORS_HEADERS,
        'body': json.dumps({'error': msg}),
    }


def _ok(body):
    return {
        'statusCode': 200,
        'headers': CORS_HEADERS,
        'body': json.dumps(body),
    }


def _require_admin(user):
    """Return None on success, error response on failure.
    SF connect/disconnect require account_admin or super_admin."""
    if user.get('is_admin'):
        return None
    if user.get('account_role') in ('account_admin', 'super_admin'):
        return None
    return _err(403, "Salesforce connect/disconnect requires account_admin or super_admin role")


def _require_account_id(user):
    """Return (account_id, None) on success or (None, error_response).
    The tenant-isolation primitive: account_id ALWAYS comes from the JWT,
    never from the request body. A user with no account_id cannot use SF
    sync (super admins must impersonate an account to connect on its behalf)."""
    aid = user.get('account_id')
    if aid is None:
        return None, _err(400, "User has no account_id; Salesforce integration is account-scoped")
    return aid, None


# ──────────────────────────────────────────────
# Push helpers — standard fields only (no custom fields in PR 2)
# SF HTTP / token / refresh helpers now live in sf_client.py.
# ──────────────────────────────────────────────
def _build_account_description(client):
    """Compose XO summary text for Account.Description.
    Standard text field, ~32K chars cap on most SF orgs."""
    parts = []
    if client.get('ai_persona'):
        parts.append(f"AI Persona:\n{client['ai_persona']}")
    if client.get('pain_point'):
        parts.append(f"Pain Point:\n{client['pain_point']}")
    if client.get('survival_metric_1'):
        parts.append(f"Survival Metric 1:\n{client['survival_metric_1']}")
    if client.get('survival_metric_2'):
        parts.append(f"Survival Metric 2:\n{client['survival_metric_2']}")
    if client.get('strategic_objective'):
        parts.append(f"Strategic Objective:\n{client['strategic_objective']}")
    parts.append(f"\n[Synced from XO Capture at {datetime.now(timezone.utc).isoformat()}]")
    return "\n\n".join(parts)


def _build_account_props(client):
    """Compose SF Account properties using STANDARD fields only.
    PR 2 deliberately avoids any XO__c custom fields — that's a v2
    commercial line item via an AppExchange package."""
    props = {'Name': client['company_name']}
    if client.get('website_url'):
        props['Website'] = client['website_url'][:255]
    if client.get('industry'):
        props['Industry'] = client['industry'][:40]
    props['Description'] = _build_account_description(client)
    return props


def _find_account_by_name(conn, account_id, tokens, name):
    """SOQL exact-name lookup. Returns SF Account Id or None."""
    q = f"SELECT Id FROM Account WHERE Name = '{soql_escape(name)}' LIMIT 1"
    status, body = sf_call_with_refresh(
        conn, account_id, tokens, 'GET', '/query/', params={'q': q}
    )
    if status != 200:
        return None
    records = body.get('records', [])
    return records[0]['Id'] if records else None


def _create_or_update_account(conn, account_id, tokens, client, existing_sf_id):
    """POST a new Account or PATCH an existing one. Returns SF Account Id."""
    props = _build_account_props(client)
    if existing_sf_id:
        status, body = sf_call_with_refresh(
            conn, account_id, tokens, 'PATCH',
            f'/sobjects/Account/{existing_sf_id}', json_body=props,
        )
        if status in (200, 204):
            return existing_sf_id
        raise RuntimeError(f"SF Account PATCH failed: status={status} body={body}")
    status, body = sf_call_with_refresh(
        conn, account_id, tokens, 'POST', '/sobjects/Account/', json_body=props,
    )
    if status in (200, 201) and body.get('id'):
        return body['id']
    raise RuntimeError(f"SF Account POST failed: status={status} body={body}")


def _create_task(conn, account_id, tokens, what_id, subject, description):
    """Create a Task linked to a parent record (Account in PR 2). Returns Task Id."""
    props = {
        'Subject': subject[:255],
        'Description': description,
        'WhatId': what_id,
        'Status': 'Completed',
        'ActivityDate': datetime.now(timezone.utc).date().isoformat(),
    }
    status, body = sf_call_with_refresh(
        conn, account_id, tokens, 'POST', '/sobjects/Task/', json_body=props,
    )
    if status in (200, 201) and body.get('id'):
        return body['id']
    raise RuntimeError(f"SF Task POST failed: status={status} body={body}")


def _log_sync(conn, account_id, record_type, record_id, sf_id, direction,
              fields_updated=None, details=None):
    cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO salesforce_sync_log
               (account_id, record_type, record_id, salesforce_id,
                sync_direction, fields_updated, details)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (account_id, record_type, record_id, sf_id, direction,
             json.dumps(fields_updated) if fields_updated else None, details),
        )
        conn.commit()
    finally:
        cur.close()


# ──────────────────────────────────────────────
# Route handlers
# ──────────────────────────────────────────────
def handle_connect(event, user):
    """POST /salesforce/connect — mint OAuth nonce, return SF authorize URL.

    The nonce binds (account_id, user_id, integration='salesforce') for
    the callback's verification. A forged callback cannot redirect tokens
    into another account because the account_id comes from the nonce row,
    not from the callback URL.
    """
    err = _require_admin(user)
    if err:
        return err
    account_id, err = _require_account_id(user)
    if err:
        return err

    if not SALESFORCE_CLIENT_ID or not SALESFORCE_REDIRECT_URI:
        return _err(500, "Salesforce OAuth env vars not configured")

    conn = get_db_connection()
    try:
        nonce = create_oauth_nonce(
            conn,
            account_id=account_id,
            user_id=user['user_id'],
            integration='salesforce',
        )
    finally:
        conn.close()

    qs = urlencode({
        'response_type': 'code',
        'client_id': SALESFORCE_CLIENT_ID,
        'redirect_uri': SALESFORCE_REDIRECT_URI,
        'scope': 'api refresh_token',
        'state': nonce,
    })
    auth_url = f"{SALESFORCE_LOGIN_URL}/services/oauth2/authorize?{qs}"
    return _ok({'auth_url': auth_url})


def handle_callback(event):
    """GET /salesforce/callback — consume nonce, exchange code, store tokens.

    Unauthenticated (browser redirect from Salesforce). The nonce IS the
    auth — single-use, 10-min TTL, account_id resolved from the stored row.
    """
    params = event.get('queryStringParameters') or {}
    code = params.get('code')
    state = params.get('state')

    if not state:
        return _err(400, "Missing state parameter")
    if not code:
        return _err(400, "Missing code parameter")

    conn = get_db_connection()
    try:
        consumed = consume_oauth_nonce(conn, state)
        if not consumed:
            return _err(400, "Invalid or expired state nonce")
        if consumed['integration'] != 'salesforce':
            return _err(
                400,
                f"Nonce integration mismatch: expected 'salesforce', "
                f"got '{consumed['integration']}'",
            )
        account_id = consumed['account_id']

        status, body = exchange_code_for_tokens(code)
        if status != 200:
            logger.error("SF token exchange failed: status=%s body=%s", status, body)
            return _err(400, f"Salesforce token exchange failed: {body.get('error', 'unknown')}")

        access = body.get('access_token')
        refresh = body.get('refresh_token')
        instance_url = body.get('instance_url')
        if not (access and refresh and instance_url):
            return _err(400, "Salesforce did not return expected tokens "
                             "(missing access_token / refresh_token / instance_url)")

        write_account_tokens(conn, account_id, access, refresh, instance_url)
    finally:
        conn.close()

    # PR 4 will replace this with a 302 to the frontend success page.
    html = (
        "<!doctype html><html><body style=\"font-family:system-ui;"
        "text-align:center;padding:3rem\">"
        "<h2>Salesforce connected.</h2>"
        "<p>You can close this window.</p>"
        "<script>setTimeout(() => window.close(), 1500);</script>"
        "</body></html>"
    )
    return {
        'statusCode': 200,
        'headers': {**CORS_HEADERS, 'Content-Type': 'text/html'},
        'body': html,
    }


def handle_status(event, user):
    """GET /salesforce/status — connection check + lightweight test call."""
    account_id, err = _require_account_id(user)
    if err:
        return err

    conn = get_db_connection()
    try:
        tokens = read_account_tokens(conn, account_id)
        if not tokens:
            return _ok({'connected': False, 'instance_url': None, 'error': None})

        connected = True
        error_msg = None
        try:
            status, body = sf_call_with_refresh(
                conn, account_id, tokens, 'GET', '/limits/'
            )
            if status != 200:
                connected = False
                error_msg = body.get('message') or f"status={status}"
        except Exception as e:
            connected = False
            error_msg = str(e)

        return _ok({
            'connected': connected,
            'instance_url': tokens['instance_url'],
            'error': error_msg,
        })
    finally:
        conn.close()


def handle_disconnect(event, user):
    """POST /salesforce/disconnect — clear tokens for this account."""
    err = _require_admin(user)
    if err:
        return err
    account_id, err = _require_account_id(user)
    if err:
        return err

    conn = get_db_connection()
    try:
        for key in (
            'salesforce_access_token',
            'salesforce_refresh_token',
            'salesforce_instance_url',
        ):
            delete_account_config(conn, account_id, key)
    finally:
        conn.close()
    return _ok({'disconnected': True})


def handle_sync_push(event, user):
    """POST /salesforce/sync/push — push XO client → SF Account.

    Body: { "client_id": "...", "engagement_id": "..." (optional) }

    Tenant isolation:
      1. account_id always from JWT, never from body.
      2. Client must belong to user's account (super_admin bypass).
      3. SF tokens resolved by JWT's account_id only.
    """
    account_id, err = _require_account_id(user)
    if err:
        return err

    try:
        body = json.loads(event.get('body') or '{}')
    except json.JSONDecodeError:
        return _err(400, "Invalid JSON body")

    client_id = body.get('client_id')
    engagement_id = body.get('engagement_id')
    if not client_id:
        return _err(400, "client_id is required")

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        # PR 3.5: legacy clients.salesforce_account_id / salesforce_last_sync
        # columns are dropped at the end of this PR. SF Account Id now lives
        # in client_salesforce_links(client_id, account_id) — per-tenant.
        cur.execute(
            """SELECT id, company_name, website_url, industry, description,
                      pain_point, survival_metric_1, survival_metric_2,
                      ai_persona, strategic_objective, account_id
               FROM clients WHERE id = %s""",
            (client_id,),
        )
        row = cur.fetchone()
        cur.close()
        if not row:
            return _err(404, f"Client {client_id} not found")

        client = {
            'id': row[0], 'company_name': row[1], 'website_url': row[2],
            'industry': row[3], 'description': row[4], 'pain_point': row[5],
            'survival_metric_1': row[6], 'survival_metric_2': row[7],
            'ai_persona': row[8], 'strategic_objective': row[9],
            'account_id': row[10],
        }

        # PR 3.4: extend ownership check to include share grants. The
        # recipient account needs a 'read_write' share (write=True) to push.
        if not can_user_access_client(conn, user, client['id'], write=True):
            return _err(403, "Client does not belong to your account, "
                             "or your share grant is read-only")

        tokens = read_account_tokens(conn, account_id)
        if not tokens:
            return _err(412, "Salesforce not connected for this account. "
                             "Call POST /salesforce/connect first.")

        # PR 3.5: lookup the actor account's SF Account Id for this client
        # via client_salesforce_links, NOT the dropped legacy column.
        # Per-tenant mapping: Intellistack's push of shared Acme reads
        # Intellistack's row; Intellagentic's push reads its own row.
        cur = conn.cursor()
        try:
            cur.execute(
                "SELECT salesforce_account_id FROM client_salesforce_links "
                "WHERE client_id = %s AND account_id = %s",
                (client['id'], account_id),
            )
            link_row = cur.fetchone()
        finally:
            cur.close()
        existing_sf_id = link_row[0] if link_row else None
        if not existing_sf_id:
            existing_sf_id = _find_account_by_name(
                conn, account_id, tokens, client['company_name']
            )

        sf_account_id = _create_or_update_account(
            conn, account_id, tokens, client, existing_sf_id
        )

        cur = conn.cursor()
        try:
            # PR 3.5: single-write to client_salesforce_links. The legacy
            # clients.salesforce_account_id / salesforce_last_sync columns
            # are dropped in this PR's migration block.
            cur.execute(
                """INSERT INTO client_salesforce_links
                       (client_id, account_id, salesforce_account_id,
                        salesforce_last_sync)
                   VALUES (%s, %s, %s, NOW())
                   ON CONFLICT (client_id, account_id) DO UPDATE
                       SET salesforce_account_id = EXCLUDED.salesforce_account_id,
                           salesforce_last_sync = EXCLUDED.salesforce_last_sync""",
                (client['id'], account_id, sf_account_id),
            )
            conn.commit()
        finally:
            cur.close()

        _log_sync(
            conn, account_id, 'client', client['id'], sf_account_id, 'push',
            fields_updated=['Name', 'Description', 'Website', 'Industry'],
            details=('created' if not existing_sf_id else 'updated'),
        )

        result = {
            'pushed': True,
            'salesforce_account_id': sf_account_id,
            'created': not existing_sf_id,
        }

        if engagement_id:
            cur = conn.cursor()
            cur.execute(
                """SELECT id, name, focus_area, status
                   FROM engagements WHERE id = %s AND client_id = %s""",
                (engagement_id, client['id']),
            )
            erow = cur.fetchone()
            cur.close()
            if not erow:
                return _err(404, f"Engagement {engagement_id} not found for this client")
            engagement = {
                'id': erow[0], 'name': erow[1],
                'focus_area': erow[2], 'status': erow[3],
            }

            subject = f"XO Engagement: {engagement['name']}"
            desc_parts = []
            if engagement.get('focus_area'):
                desc_parts.append(f"Focus area:\n{engagement['focus_area']}")
            if engagement.get('status'):
                desc_parts.append(f"Status: {engagement['status']}")
            task_id = _create_task(
                conn, account_id, tokens, sf_account_id,
                subject, "\n\n".join(desc_parts),
            )

            cur = conn.cursor()
            try:
                cur.execute(
                    "UPDATE engagements SET salesforce_task_id = %s, "
                    "salesforce_synced_at = NOW() WHERE id = %s",
                    (task_id, engagement['id']),
                )
                conn.commit()
            finally:
                cur.close()
            _log_sync(
                conn, account_id, 'engagement', engagement['id'], task_id, 'push',
                fields_updated=['Subject', 'Description', 'WhatId'],
            )
            result['salesforce_task_id'] = task_id

        return _ok(result)
    finally:
        conn.close()


def handle_sync_pull(event, user):
    """POST /salesforce/sync/pull — pull Account/Contact/Opportunity
    changes since last sync.

    Team model only. account_id is sourced from JWT — body is currently
    ignored. PR 3.5 added Contact + Opportunity to the pull loop; each
    entity tracks its own high-water timestamp in system_config.
    """
    account_id, err = _require_account_id(user)
    if err:
        return err

    conn = get_db_connection()
    try:
        tokens = read_account_tokens(conn, account_id)
        if not tokens:
            return _err(412, "Salesforce not connected for this account. "
                             "Call POST /salesforce/connect first.")

        # Order: Account first so Contact and Opportunity reconcile against
        # the freshest XO client set (and any newly-created clients from the
        # Account pull have client_salesforce_links rows by the time we look
        # them up in the Contact/Opportunity reconcilers).
        accounts_summary = pull_accounts(conn, account_id, tokens)
        contacts_summary = pull_contacts(conn, account_id, tokens)
        opps_summary = pull_opportunities(conn, account_id, tokens)
        return _ok({
            'pulled': True,
            'accounts': accounts_summary,
            'contacts': contacts_summary,
            'opportunities': opps_summary,
        })
    finally:
        conn.close()


# ──────────────────────────────────────────────
# Lambda handler / router
# ──────────────────────────────────────────────
def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    path = event.get('path', '')
    method = event.get('httpMethod', '')

    # OAuth callback — no JWT (browser redirect from Salesforce).
    # Authentication is via single-use nonce inside handle_callback.
    if '/salesforce/callback' in path and method == 'GET':
        response = handle_callback(event)
        log_activity(event, response)
        return response

    # Outbound Message webhook — no JWT (no shared secret from Salesforce).
    # Auth is via OrganizationId verification inside handle_outbound_message:
    # URL ?account_id=X plus SOAP <OrganizationId> must both resolve to the
    # same stored salesforce_org_id. Always returns 200 + SOAP ACK envelope
    # (Ack=true on success, Ack=false on rejection — SF stops retrying).
    if '/webhooks/salesforce/outbound-message' in path and method == 'POST':
        response = handle_outbound_message(event, get_db_connection)
        log_activity(event, response)
        return response

    # All other routes require auth.
    user, err = require_auth(event)
    if err:
        log_activity(event, err)
        return err

    response = _route_salesforce(event, user, path, method)
    log_activity(event, response, user)
    return response


def _route_salesforce(event, user, path, method):
    if '/salesforce/connect' in path and method == 'POST':
        return handle_connect(event, user)
    if '/salesforce/status' in path and method == 'GET':
        return handle_status(event, user)
    if '/salesforce/disconnect' in path and method == 'POST':
        return handle_disconnect(event, user)
    if '/salesforce/sync/push' in path and method == 'POST':
        return handle_sync_push(event, user)
    if '/salesforce/sync/pull' in path and method == 'POST':
        return handle_sync_pull(event, user)
    return _err(404, f"No route for {method} {path}")
