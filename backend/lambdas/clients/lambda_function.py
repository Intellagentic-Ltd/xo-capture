"""
XO Platform - POST /clients Lambda
Creates a new client with S3 folder structure and PostgreSQL record.
"""

import json
import os
import re
import time
import hashlib
import secrets
import boto3
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone, timedelta
from auth_helper import require_auth, get_db_connection, CORS_HEADERS, log_activity
from client_access import clients_where_fragment, can_user_access_client
try:
    from crypto_helper import (
        encrypt, decrypt, encrypt_json, decrypt_json, search_hash,
        generate_client_key, unwrap_client_key,
        client_encrypt, client_decrypt, client_encrypt_json, client_decrypt_json,
        encrypt_s3_body, decrypt_s3_body, encrypt_s3_bytes, decrypt_s3_bytes,
        maybe_encrypt_s3_body, maybe_decrypt_s3_body, maybe_encrypt_s3_bytes, maybe_decrypt_s3_bytes,
        is_s3_encryption_enabled
    )
except ImportError:
    # Fallback pass-through stubs if crypto_helper.py not yet deployed
    import json as _json, hashlib as _hl
    def encrypt(x): return x
    def decrypt(x): return x
    def encrypt_json(x): return _json.dumps(x) if x else x
    def decrypt_json(x):
        if not x: return None
        try: return _json.loads(x)
        except: return None
    def search_hash(x): return _hl.sha256(x.lower().strip().encode()).hexdigest() if x else ''
    def generate_client_key(): return ''
    def unwrap_client_key(x): return None
    def client_encrypt(k, x): return x
    def client_decrypt(k, x): return x
    def client_encrypt_json(k, x): return _json.dumps(x) if x else x
    def client_decrypt_json(k, x):
        if not x: return None
        try: return _json.loads(x)
        except: return None
    def encrypt_s3_body(k, b): return b if isinstance(b, bytes) else (b.encode('utf-8') if b else b'')
    def decrypt_s3_body(k, b): return b if isinstance(b, str) else b.decode('utf-8', errors='replace') if b else ''
    def encrypt_s3_bytes(k, d): return d
    def decrypt_s3_bytes(k, d): return d

s3_client = boto3.client('s3')
BUCKET_NAME = os.environ.get('BUCKET_NAME', 'xo-client-data-mv')
STREAMLINE_WEBHOOK_URL = os.environ.get('STREAMLINE_WEBHOOK_URL', '')
STREAMLINE_INVITE_WEBHOOK_URL = os.environ.get('STREAMLINE_INVITE_WEBHOOK_URL', '')
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'https://xo.intellagentic.io')


def _resolve_contact_photos(contacts):
    """Resolve S3 keys in contact photo_url to fresh presigned URLs."""
    for c in contacts:
        photo = c.get('photo_url', '')
        if not photo:
            continue
        # If it's already a full URL (http/https), check if it's an expired presigned URL
        if photo.startswith('http'):
            if 'xo-client-data-mv.s3' in photo:
                # Extract the S3 key from the presigned URL
                parsed = urllib.parse.urlparse(photo)
                s3_key = parsed.path.lstrip('/')
                try:
                    c['photo_url'] = s3_client.generate_presigned_url(
                        'get_object',
                        Params={'Bucket': BUCKET_NAME, 'Key': s3_key},
                        ExpiresIn=3600
                    )
                except Exception:
                    c['photo_url'] = ''
            # Otherwise it's an external URL — leave it
        else:
            # It's a bare S3 key — generate presigned URL
            try:
                c['photo_url'] = s3_client.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': BUCKET_NAME, 'Key': photo},
                    ExpiresIn=3600
                )
            except Exception:
                c['photo_url'] = ''
    return contacts


# ── Auto-migration: add streamline_webhook_url column if missing ──
def _run_migrations():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS streamline_webhook_url VARCHAR(1000);")
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS invite_webhook_url VARCHAR(1000);")
        # Per-client encryption key (encrypted with master key)
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS encryption_key TEXT;")
        # Track who last updated the client (encrypted user name)
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_by TEXT;")
        # NDA signed flag and existing apps text
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS nda_signed BOOLEAN DEFAULT FALSE;")
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS nda_signed_at TIMESTAMP;")
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS existing_apps TEXT;")
        # Approval flow
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;")
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS approved_by TEXT;")
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS company_linkedin TEXT;")
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS poc_scope JSONB;")
        # Engagements table
        cur.execute("""CREATE TABLE IF NOT EXISTS engagements (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            focus_area TEXT,
            contacts_json TEXT,
            status VARCHAR(50) DEFAULT 'active',
            approved_at TIMESTAMP WITH TIME ZONE,
            approved_by TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            hubspot_deal_id VARCHAR(50)
        )""")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_engagements_client_id ON engagements(client_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_engagements_status ON engagements(status)")
        cur.execute("ALTER TABLE enrichments ADD COLUMN IF NOT EXISTS engagement_id UUID")
        cur.execute("ALTER TABLE engagements ADD COLUMN IF NOT EXISTS poc_scope JSONB")
        cur.execute("ALTER TABLE engagements ADD COLUMN IF NOT EXISTS scope_review_needed BOOLEAN DEFAULT FALSE")
        # Migrate existing clients.poc_scope to most recent engagement
        cur.execute("""
            UPDATE engagements e
            SET poc_scope = c.poc_scope
            FROM clients c
            WHERE e.client_id = c.id
              AND c.poc_scope IS NOT NULL
              AND e.poc_scope IS NULL
              AND e.id = (
                  SELECT id FROM engagements
                  WHERE client_id = c.id
                  ORDER BY created_at DESC LIMIT 1
              )
        """)
        conn.commit()
        cur.close()
        conn.close()
        print("Migration complete: all client columns + engagements table ensured")
    except Exception as e:
        print(f"Migration check (non-fatal): {e}")

_run_migrations()


# ── Auto-migration: make skills.client_id nullable + seed system skills ──
SYSTEM_SKILLS = [
    ('analysis-framework', '_system/skills/analysis-framework.md'),
    ('output-format', '_system/skills/output-format.md'),
    ('authority-boundaries', '_system/skills/authority-boundaries.md'),
    ('enrichment-process', '_system/skills/enrichment-process.md'),
    ('client-facing-summary', '_system/skills/client-facing-summary.md'),
    ('streamline-applications', '_system/skills/streamline-applications.md'),
]

def _run_skill_migrations():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        # Make client_id nullable
        cur.execute("ALTER TABLE skills ALTER COLUMN client_id DROP NOT NULL;")
        # Seed system skills (client_id IS NULL) if they don't exist
        for name, s3_key in SYSTEM_SKILLS:
            cur.execute(
                "SELECT id FROM skills WHERE client_id IS NULL AND name = %s",
                (name,)
            )
            if not cur.fetchone():
                cur.execute(
                    "INSERT INTO skills (client_id, name, s3_key) VALUES (NULL, %s, %s)",
                    (name, s3_key)
                )
                print(f"Seeded system skill: {name}")
        conn.commit()
        cur.close()
        conn.close()
        print("Skill migration complete: client_id nullable + system skills seeded")
    except Exception as e:
        print(f"Skill migration check (non-fatal): {e}")

_run_skill_migrations()


# ── Auto-migration: accounts table + client account_id/intellagentic_lead ──
def _run_account_migrations():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS accounts (
                id SERIAL PRIMARY KEY,
                name VARCHAR(500) NOT NULL,
                company VARCHAR(500),
                email VARCHAR(500),
                phone VARCHAR(200),
                industry VARCHAR(300),
                notes TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        """)
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;")
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS intellagentic_lead BOOLEAN DEFAULT FALSE;")
        # Account org profile columns
        cur.execute("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS website VARCHAR(500);")
        cur.execute("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS contacts_json TEXT;")
        cur.execute("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS addresses_json TEXT;")
        # Future plans + pain points (both clients and accounts)
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS future_plans TEXT;")
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS pain_points_json TEXT;")
        cur.execute("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS description TEXT;")
        cur.execute("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS future_plans TEXT;")
        cur.execute("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pain_points_json TEXT;")
        conn.commit()
        cur.close()
        conn.close()
        print("Account migration complete: accounts table + client columns ensured")
    except Exception as e:
        print(f"Account migration check (non-fatal): {e}")

_run_account_migrations()


# ── Auto-migration: invite support (source column, nullable user_id) ──
def _run_invite_migrations():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS source VARCHAR(50);")
        cur.execute("ALTER TABLE clients ALTER COLUMN user_id DROP NOT NULL;")
        conn.commit()
        cur.close()
        conn.close()
        print("Invite migration complete: source column + nullable user_id ensured")
    except Exception as e:
        print(f"Invite migration check (non-fatal): {e}")

_run_invite_migrations()


# ── Auto-migration: system_config key/value table ──
def _run_system_config_migration():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS system_config (
                id SERIAL PRIMARY KEY,
                config_key VARCHAR(255) UNIQUE NOT NULL,
                config_value TEXT,
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        conn.commit()
        cur.close()
        conn.close()
        print("Migration complete: system_config table ensured")
    except Exception as e:
        print(f"system_config migration check (non-fatal): {e}")

_run_system_config_migration()


# ── Auto-migration: integrations infrastructure ──
# Adds the schema required by Salesforce and Gong integrations:
#   1. system_config.account_id  — multi-tenant scoping for new integrations
#   2. oauth_state_nonces        — CSRF defense for OAuth /connect → /callback
#   3. client_integrations       — partner-model per-client connection overrides
#
# IMPORTANT — HUBSPOT ASYMMETRY:
# HubSpot is intentionally global (account_id IS NULL). hubspot-sync's
# _get_config / _set_config (hubspot-sync/lambda_function.py:177-198) read and
# write without account scoping. Do NOT "fix" this by backfilling HubSpot rows
# to an Intellagentic account_id — it will break the production HubSpot sync.
# Salesforce and Gong route through shared/integrations_config.py instead,
# which requires a non-NULL account_id.
def _run_integrations_migration():
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # 1. system_config: add account_id scoping.
        cur.execute(
            "ALTER TABLE system_config ADD COLUMN IF NOT EXISTS account_id "
            "INTEGER REFERENCES accounts(id) ON DELETE CASCADE"
        )
        # Drop the legacy global UNIQUE(config_key) — replaced with the
        # account-scoped index below. NULLS NOT DISTINCT keeps HubSpot's
        # single NULL-scoped row unique without resorting to COALESCE tricks.
        cur.execute(
            "ALTER TABLE system_config "
            "DROP CONSTRAINT IF EXISTS system_config_config_key_key"
        )
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_system_config_account_key "
            "ON system_config (account_id, config_key) NULLS NOT DISTINCT"
        )

        # 2. oauth_state_nonces: short-lived single-use CSRF tokens.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS oauth_state_nonces (
                nonce TEXT PRIMARY KEY,
                account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
                client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                integration TEXT NOT NULL CHECK (integration IN ('salesforce', 'gong')),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL
            )
        """)
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_oauth_nonces_expires "
            "ON oauth_state_nonces(expires_at)"
        )

        # 3. client_integrations: per-client connection overrides (partner model).
        # connected_by uses ON DELETE SET NULL — audit pointer must not block
        # user deletion, and the integration row must survive a user delete.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS client_integrations (
                client_id UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,

                salesforce_instance_url TEXT,
                salesforce_access_token_encrypted TEXT,
                salesforce_refresh_token_encrypted TEXT,
                salesforce_token_expiry TIMESTAMP WITH TIME ZONE,
                salesforce_connected_by UUID REFERENCES users(id) ON DELETE SET NULL,
                salesforce_connected_at TIMESTAMP WITH TIME ZONE,

                gong_workspace_id TEXT,
                gong_access_key_encrypted TEXT,
                gong_access_key_secret_encrypted TEXT,
                gong_webhook_secret_encrypted TEXT,
                gong_connected_by UUID REFERENCES users(id) ON DELETE SET NULL,
                gong_connected_at TIMESTAMP WITH TIME ZONE,

                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """)

        conn.commit()
        cur.close()
        conn.close()
        print("Integrations migration complete: system_config.account_id + "
              "oauth_state_nonces + client_integrations ensured")
    except Exception as e:
        print(f"Integrations migration check (non-fatal): {e}")


_run_integrations_migration()


# ── Auto-migration: cross-tenant client sharing (PR 3.4) ──
# Adds:
#   1. client_shares                — grant table; account-level share of a
#                                     single client. Composite PK on
#                                     (client_id, shared_with_account_id).
#   2. client_salesforce_links      — per-tenant SF mapping. The single-tenant
#                                     clients.salesforce_account_id columns
#                                     are kept populated via dual-write in
#                                     salesforce-sync during the PR 3.4 → PR
#                                     3.5 transition. PR 3.5 cuts SF over to
#                                     this table and drops the legacy column.
#   3. Backfill                     — idempotently populate
#                                     client_salesforce_links from existing
#                                     clients rows where salesforce_account_id
#                                     is not null.
def _run_sharing_migration():
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # 1. client_shares
        cur.execute("""
            CREATE TABLE IF NOT EXISTS client_shares (
                client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                shared_with_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                granted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                permissions VARCHAR(20) NOT NULL DEFAULT 'read_write'
                    CHECK (permissions IN ('read_only', 'read_write')),
                PRIMARY KEY (client_id, shared_with_account_id)
            )
        """)
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_client_shares_recipient "
            "ON client_shares(shared_with_account_id)"
        )

        # 2. client_salesforce_links — per-tenant SF mapping.
        # PR 3.5 will route salesforce-sync reads/writes through this table
        # and drop the legacy clients.salesforce_account_id /
        # salesforce_last_sync columns. PR 3.4 dual-writes to both.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS client_salesforce_links (
                client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                salesforce_account_id VARCHAR(18),
                salesforce_last_sync TIMESTAMP WITH TIME ZONE,
                PRIMARY KEY (client_id, account_id)
            )
        """)
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_client_sf_links_sf_account "
            "ON client_salesforce_links(salesforce_account_id)"
        )

        # 3. Backfill from legacy clients columns. Idempotent (ON CONFLICT).
        cur.execute("""
            INSERT INTO client_salesforce_links
                (client_id, account_id, salesforce_account_id, salesforce_last_sync)
            SELECT id, account_id, salesforce_account_id, salesforce_last_sync
            FROM clients
            WHERE salesforce_account_id IS NOT NULL
              AND account_id IS NOT NULL
            ON CONFLICT (client_id, account_id) DO NOTHING
        """)

        conn.commit()
        cur.close()
        conn.close()
        print("Sharing migration complete: client_shares + client_salesforce_links "
              "ensured; legacy SF columns backfilled.")
    except Exception as e:
        print(f"Sharing migration check (non-fatal): {e}")


_run_sharing_migration()


def _get_client_key(cur, s3_folder):
    """Look up and unwrap a client's encryption key by s3_folder. Returns raw key bytes or None."""
    try:
        cur.execute("SELECT encryption_key FROM clients WHERE s3_folder = %s", (s3_folder,))
        row = cur.fetchone()
        if row and row[0]:
            return unwrap_client_key(row[0])
    except Exception as e:
        print(f"Failed to get client key (non-fatal): {e}")
    return None


def _get_client_key_by_id(cur, db_client_id):
    """Look up and unwrap a client's encryption key by DB id. Returns raw key bytes or None."""
    try:
        cur.execute("SELECT encryption_key FROM clients WHERE id = %s", (db_client_id,))
        row = cur.fetchone()
        if row and row[0]:
            return unwrap_client_key(row[0])
    except Exception as e:
        print(f"Failed to get client key by id (non-fatal): {e}")
    return None


def lambda_handler(event, context):
    """
    Method router for /clients:
      GET  /clients?client_id=X  -> fetch existing client data
      POST /clients              -> create new client
      PUT  /clients              -> update existing client
    """

    # Handle OPTIONS preflight
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    path = event.get('path', '')
    method = event.get('httpMethod', '')

    # Public invite endpoint — no auth required
    if path.endswith('/invite') and method == 'POST':
        response = handle_invite(event)
        log_activity(event, response)
        return response

    # Auth check
    user, err = require_auth(event)
    if err:
        log_activity(event, err)
        return err

    response = _route_clients(event, user, path, method)
    log_activity(event, response, user)
    return response


def _route_clients(event, user, path, method):
    # Derive role — old JWTs may have is_admin/is_account but no role field
    role = user.get('role', 'client')
    if user.get('is_admin'):
        role = 'admin'
    elif user.get('is_account'):
        role = 'account'
    is_client_user = role == 'client'
    is_account_user = role == 'account'

    # Proxy route — POST JSON to an external URL (avoids CORS)
    if '/proxy' in path and method == 'POST':
        return handle_proxy(event, user)

    # System config routes — admin only
    if '/system-config' in path:
        if not user.get('is_admin'):
            return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Admin access required'})}
        if path.endswith('/s3-encryption-convert') and method == 'POST':
            return handle_s3_encryption_convert(event, user)
        if method == 'GET':
            return handle_get_system_config(event, user)
        elif method == 'PUT':
            return handle_update_system_config(event, user)

    # Accounts routes — admin only (accounts can read list for reference)
    if '/accounts' in path:
        if is_client_user:
            return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Access denied'})}
        if method == 'GET':
            return handle_list_accounts(event, user)
        elif not user.get('is_admin'):
            return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Admin access required'})}
        elif method == 'POST':
            return handle_create_account(event, user)
        elif method == 'PUT':
            return handle_update_account(event, user)
        elif method == 'DELETE':
            return handle_delete_account(event, user)

    # Skills routes — client users can read but not write
    if '/skills' in path:
        if method == 'GET':
            return handle_get_skills(event, user)
        elif is_client_user:
            return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Access denied'})}
        elif method == 'POST':
            return handle_create_skill(event, user)
        elif method == 'PUT':
            return handle_update_skill(event, user)
        elif method == 'DELETE':
            return handle_delete_skill(event, user)

    if '/engagements' in path:
        if method == 'GET':
            return handle_list_engagements(event, user)
        elif method == 'POST':
            return handle_create_engagement(event, user)
        elif method == 'PUT':
            return handle_update_engagement(event, user)
        elif method == 'DELETE':
            return handle_delete_engagement(event, user)

    if path.endswith('/clients/list') and method == 'GET':
        return handle_list_clients(event, user)
    elif method == 'GET':
        params = event.get('queryStringParameters') or {}
        if params.get('action') == 'scope':
            if not user.get('is_admin'):
                return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Admin access required'})}
            return handle_get_scope(event, user)
        if not params.get('client_id'):
            return handle_list_clients(event, user)
        return handle_get_client(event, user)
    elif method == 'PUT':
        params = event.get('queryStringParameters') or {}
        if params.get('action') == 'scope':
            if not user.get('is_admin'):
                return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Admin access required'})}
            return handle_update_scope(event, user)
        return handle_update_client(event, user)
    elif method == 'POST':
        # Block legacy token-scoped client users (carry client_id claim) and
        # read-only client_contacts. Allow super_admin, account_admin,
        # account_user, contributor, and legacy is_account.
        # NB: is_client alone is not sufficient — multi-tenant roles carry
        # is_client=True because users.role='client'. The client_id claim
        # uniquely identifies legacy token-scoped users.
        if (user.get('is_client') and user.get('client_id')) or user.get('account_role') == 'client_contact':
            return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Access denied'})}
        return handle_create_client(event, user)
    elif method == 'DELETE':
        if is_client_user or is_account_user:
            return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Access denied'})}
        return handle_delete_client(event, user)
    else:
        return {
            'statusCode': 405,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': f'Method not allowed: {method}'})
        }


def handle_get_skills(event, user):
    """GET /skills — List skills. ?client_id=X returns system+client combined. ?scope=system returns system only."""
    params = event.get('queryStringParameters') or {}
    client_id = params.get('client_id', '').strip()
    scope = params.get('scope', '').strip()

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        skills = []

        if scope == 'system':
            cur.execute("""
                SELECT id, name, content, s3_key, created_at
                FROM skills WHERE client_id IS NULL ORDER BY name
            """)
            for row in cur.fetchall():
                skills.append({
                    'id': str(row[0]), 'name': row[1], 'content': row[2] or '',
                    's3_key': row[3] or '', 'created_at': row[4].isoformat() if row[4] else None,
                    'scope': 'system'
                })
        else:
            # System skills first
            cur.execute("""
                SELECT id, name, content, s3_key, created_at
                FROM skills WHERE client_id IS NULL ORDER BY name
            """)
            for row in cur.fetchall():
                skills.append({
                    'id': str(row[0]), 'name': row[1], 'content': row[2] or '',
                    's3_key': row[3] or '', 'created_at': row[4].isoformat() if row[4] else None,
                    'scope': 'system'
                })

            # Then client skills
            if client_id:
                cur.execute("""
                    SELECT s.id, s.name, s.content, s.s3_key, s.created_at
                    FROM skills s
                    JOIN clients c ON s.client_id = c.id
                    WHERE c.s3_folder = %s
                    ORDER BY s.name
                """, (client_id,))
                for row in cur.fetchall():
                    skills.append({
                        'id': str(row[0]), 'name': row[1], 'content': row[2] or '',
                        's3_key': row[3] or '', 'created_at': row[4].isoformat() if row[4] else None,
                        'scope': 'client'
                    })

        # Load content from S3 for skills that only have s3_key
        # Get client key if we have a client_id
        ck = _get_client_key(cur, client_id) if client_id else None
        for skill in skills:
            if not skill['content'] and skill['s3_key']:
                try:
                    obj = s3_client.get_object(Bucket=BUCKET_NAME, Key=skill['s3_key'])
                    raw = obj['Body'].read()
                    # Client skills: decrypt with client key if encrypted; system skills: read as-is
                    if skill['scope'] == 'client' and ck:
                        skill['content'] = maybe_decrypt_s3_body(ck, raw)
                    else:
                        skill['content'] = raw.decode('utf-8', errors='replace')
                except Exception as e:
                    print(f"Failed to load skill content from S3 ({skill['s3_key']}): {e}")

        cur.close()
        conn.close()
        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'skills': skills})
        }
    except Exception as e:
        print(f"Error listing skills: {e}")
        cur.close()
        conn.close()
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Internal server error', 'message': str(e)})
        }


def handle_create_skill(event, user):
    """POST /skills — Create a skill. scope=system requires is_admin."""
    try:
        body = json.loads(event.get('body', '{}'))
        name = body.get('name', '').strip()
        content = body.get('content', '').strip()
        scope = body.get('scope', 'client').strip()
        client_id = body.get('client_id', '').strip()

        if not name:
            return {'statusCode': 400, 'headers': CORS_HEADERS,
                    'body': json.dumps({'error': 'name is required'})}

        if scope == 'system':
            if not user.get('is_admin'):
                return {'statusCode': 403, 'headers': CORS_HEADERS,
                        'body': json.dumps({'error': 'Admin required for system skills'})}
            s3_key = f"_system/skills/{name}.md"
            # Write content to S3
            if content:
                s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key, Body=content, ContentType='text/markdown')
            conn = get_db_connection()
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO skills (client_id, name, content, s3_key) VALUES (NULL, %s, %s, %s) RETURNING id",
                (name, content, s3_key)
            )
            skill_id = str(cur.fetchone()[0])
            conn.commit()
            cur.close()
            conn.close()
        else:
            if not client_id:
                return {'statusCode': 400, 'headers': CORS_HEADERS,
                        'body': json.dumps({'error': 'client_id is required for client skills'})}
            conn = get_db_connection()
            cur = conn.cursor()
            # Resolve s3_folder to DB id
            cur.execute("SELECT id FROM clients WHERE s3_folder = %s", (client_id,))
            row = cur.fetchone()
            if not row:
                cur.close()
                conn.close()
                return {'statusCode': 404, 'headers': CORS_HEADERS,
                        'body': json.dumps({'error': 'Client not found'})}
            db_client_id = str(row[0])
            s3_key = f"{client_id}/skills/{name}.md"
            if content:
                ck = _get_client_key(cur, client_id)
                s3_enc = is_s3_encryption_enabled(cur)
                s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key, Body=maybe_encrypt_s3_body(ck, content, enabled=s3_enc), ContentType='application/octet-stream')
            cur.execute(
                "INSERT INTO skills (client_id, name, content, s3_key) VALUES (%s, %s, %s, %s) RETURNING id",
                (db_client_id, name, content, s3_key)
            )
            skill_id = str(cur.fetchone()[0])
            conn.commit()
            cur.close()
            conn.close()

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'skill_id': skill_id, 'status': 'created', 'scope': scope})
        }
    except Exception as e:
        print(f"Error creating skill: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Internal server error', 'message': str(e)})}


def handle_update_skill(event, user):
    """PUT /skills — Update a skill. System skills require is_admin."""
    try:
        body = json.loads(event.get('body', '{}'))
        skill_id = body.get('skill_id', '').strip()
        name = body.get('name', '').strip()
        content = body.get('content', '').strip()

        if not skill_id:
            return {'statusCode': 400, 'headers': CORS_HEADERS,
                    'body': json.dumps({'error': 'skill_id is required'})}

        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, client_id, s3_key FROM skills WHERE id = %s", (skill_id,))
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return {'statusCode': 404, 'headers': CORS_HEADERS,
                    'body': json.dumps({'error': 'Skill not found'})}

        is_system = row[1] is None
        if is_system and not user.get('is_admin'):
            cur.close()
            conn.close()
            return {'statusCode': 403, 'headers': CORS_HEADERS,
                    'body': json.dumps({'error': 'Admin required for system skills'})}

        # Update DB
        updates = []
        params = []
        if name:
            updates.append("name = %s")
            params.append(name)
        if content is not None:
            updates.append("content = %s")
            params.append(content)

        if updates:
            params.append(skill_id)
            cur.execute(f"UPDATE skills SET {', '.join(updates)} WHERE id = %s", params)

        # Update S3 file
        s3_key = row[2]
        if content and s3_key:
            if is_system:
                s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key, Body=content, ContentType='text/markdown')
            else:
                # Client skill — optionally encrypt with client key
                skill_ck = _get_client_key_by_id(cur, row[1]) if row[1] else None
                s3_enc = is_s3_encryption_enabled(cur)
                s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key, Body=maybe_encrypt_s3_body(skill_ck, content, enabled=s3_enc), ContentType='application/octet-stream')
        elif content and is_system and name:
            s3_key = f"_system/skills/{name}.md"
            s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key, Body=content, ContentType='text/markdown')

        conn.commit()
        cur.close()
        conn.close()
        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'skill_id': skill_id, 'status': 'updated'})
        }
    except Exception as e:
        print(f"Error updating skill: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Internal server error', 'message': str(e)})}


def handle_delete_skill(event, user):
    """DELETE /skills?skill_id=X — Delete a skill + S3 file. System skills require is_admin."""
    try:
        params = event.get('queryStringParameters') or {}
        skill_id = params.get('skill_id', '').strip()

        if not skill_id:
            return {'statusCode': 400, 'headers': CORS_HEADERS,
                    'body': json.dumps({'error': 'skill_id is required'})}

        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, client_id, s3_key FROM skills WHERE id = %s", (skill_id,))
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return {'statusCode': 404, 'headers': CORS_HEADERS,
                    'body': json.dumps({'error': 'Skill not found'})}

        is_system = row[1] is None
        if is_system and not user.get('is_admin'):
            cur.close()
            conn.close()
            return {'statusCode': 403, 'headers': CORS_HEADERS,
                    'body': json.dumps({'error': 'Admin required for system skills'})}

        # Delete S3 file
        s3_key = row[2]
        if s3_key:
            try:
                s3_client.delete_object(Bucket=BUCKET_NAME, Key=s3_key)
            except Exception as e:
                print(f"Warning: failed to delete S3 skill ({s3_key}): {e}")

        cur.execute("DELETE FROM skills WHERE id = %s", (skill_id,))
        conn.commit()
        cur.close()
        conn.close()
        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'deleted': True, 'skill_id': skill_id})
        }
    except Exception as e:
        print(f"Error deleting skill: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Internal server error', 'message': str(e)})}


def handle_list_accounts(event, user):
    """GET /accounts — List all accounts (admin only)."""
    if not user.get('is_admin'):
        return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Admin access required'})}
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id, name, company, email, phone, industry, notes, created_at, updated_at, website, contacts_json, addresses_json, description, future_plans, pain_points_json FROM accounts ORDER BY name")
        accounts = []
        for row in cur.fetchall():
            contacts = []
            addresses = []
            try:
                if row[10]:
                    contacts = json.loads(row[10]) if isinstance(row[10], str) else row[10]
            except Exception:
                pass
            try:
                if row[11]:
                    addresses = json.loads(row[11]) if isinstance(row[11], str) else row[11]
            except Exception:
                pass
            pain_points = []
            try:
                if row[14]:
                    pain_points = json.loads(row[14])
            except Exception:
                pass
            accounts.append({
                'id': row[0], 'name': row[1] or '', 'company': row[2] or '',
                'email': row[3] or '', 'phone': row[4] or '', 'industry': row[5] or '',
                'notes': row[6] or '',
                'created_at': row[7].isoformat() if row[7] else None,
                'updated_at': row[8].isoformat() if row[8] else None,
                'website': row[9] or '',
                'contacts': contacts,
                'addresses': addresses,
                'description': row[12] or '',
                'futurePlans': row[13] or '',
                'painPoints': pain_points
            })
        cur.close()
        conn.close()
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({'accounts': accounts})}
    except Exception as e:
        print(f"Error listing accounts: {e}")
        cur.close()
        conn.close()
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}


def handle_create_account(event, user):
    """POST /accounts — Create a new account (admin only)."""
    if not user.get('is_admin'):
        return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Admin access required'})}
    body = json.loads(event.get('body', '{}'))
    name = body.get('name', '').strip()
    if not name:
        return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'name is required'})}
    conn = get_db_connection()
    cur = conn.cursor()
    contacts = body.get('contacts')
    addresses = body.get('addresses')
    p_pain_points = body.get('painPoints', [])
    contacts_json = json.dumps(contacts) if contacts else None
    addresses_json = json.dumps(addresses) if addresses else None
    try:
        cur.execute("""
            INSERT INTO accounts (name, company, email, phone, industry, notes, website, contacts_json, addresses_json, description, future_plans, pain_points_json)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
        """, (name, body.get('company', '').strip(),
              body.get('email', '').strip(),
              body.get('phone', '').strip(),
              body.get('industry', '').strip(), body.get('notes', '').strip(),
              body.get('website', '').strip(),
              contacts_json, addresses_json,
              body.get('description', '').strip(), body.get('futurePlans', '').strip(),
              json.dumps(p_pain_points) if p_pain_points else None))
        account_id = cur.fetchone()[0]
        conn.commit()
        cur.close()
        conn.close()
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({'id': account_id, 'status': 'created'})}
    except Exception as e:
        print(f"Error creating account: {e}")
        cur.close()
        conn.close()
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}


def handle_update_account(event, user):
    """PUT /accounts — Update an existing account (admin only)."""
    if not user.get('is_admin'):
        return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Admin access required'})}
    body = json.loads(event.get('body', '{}'))
    account_id = body.get('id')
    if not account_id:
        return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'id is required'})}
    conn = get_db_connection()
    cur = conn.cursor()
    contacts = body.get('contacts')
    addresses = body.get('addresses')
    u_pain_points = body.get('painPoints', [])
    contacts_json = json.dumps(contacts) if contacts else None
    addresses_json = json.dumps(addresses) if addresses else None
    try:
        cur.execute("""
            UPDATE accounts SET name=%s, company=%s, email=%s, phone=%s, industry=%s, notes=%s,
                   website=%s, contacts_json=%s, addresses_json=%s,
                   description=%s, future_plans=%s, pain_points_json=%s, updated_at=NOW()
            WHERE id=%s RETURNING id
        """, (body.get('name', '').strip(), body.get('company', '').strip(),
              body.get('email', '').strip(),
              body.get('phone', '').strip(),
              body.get('industry', '').strip(), body.get('notes', '').strip(),
              body.get('website', '').strip(),
              contacts_json, addresses_json,
              body.get('description', '').strip(), body.get('futurePlans', '').strip(),
              json.dumps(u_pain_points) if u_pain_points else None, account_id))
        row = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()
        if not row:
            return {'statusCode': 404, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Partner not found'})}
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({'id': account_id, 'status': 'updated'})}
    except Exception as e:
        print(f"Error updating account: {e}")
        cur.close()
        conn.close()
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}


def handle_delete_account(event, user):
    """DELETE /accounts — Delete an account (admin only). Clients with this account get NULL."""
    if not user.get('is_admin'):
        return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Admin access required'})}
    params = event.get('queryStringParameters') or {}
    account_id = params.get('id')
    if not account_id:
        return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'id is required'})}
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM accounts WHERE id = %s RETURNING id", (account_id,))
        row = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()
        if not row:
            return {'statusCode': 404, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Partner not found'})}
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({'deleted': True})}
    except Exception as e:
        print(f"Error deleting account: {e}")
        cur.close()
        conn.close()
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}


def handle_list_clients(event, user):
    """GET /clients/list — List all clients for the logged-in user with stats."""
    conn = get_db_connection()
    cur = conn.cursor()

    try:
        base_query = """
            SELECT c.id, c.company_name, c.industry, c.s3_folder, c.status,
                   c.created_at, c.updated_at,
                   (SELECT COUNT(*) FROM uploads u WHERE u.client_id = c.id AND u.status = 'active') as source_count,
                   (SELECT e.status FROM enrichments e WHERE e.client_id = c.id ORDER BY e.started_at DESC LIMIT 1) as last_enrichment_status,
                   (SELECT e.completed_at FROM enrichments e WHERE e.client_id = c.id ORDER BY e.started_at DESC LIMIT 1) as last_enrichment_date,
                   c.icon_s3_key,
                   u.name as owner_name,
                   a.name as account_name,
                   c.account_id,
                   COALESCE(c.intellagentic_lead, FALSE) as intellagentic_lead,
                   c.updated_by,
                   COALESCE(c.nda_signed, FALSE) as nda_signed,
                   c.existing_apps,
                   c.nda_signed_at
            FROM clients c
            LEFT JOIN users u ON c.user_id = u.id
            LEFT JOIN accounts a ON c.account_id = a.id
        """
        # PR 3.4: single source of truth for cross-tenant + role-based access.
        # Helper returns ('TRUE', ()) for super admins so the same code path
        # serves every role; the WHERE clause stays uniform.
        where_frag, where_params = clients_where_fragment(user, alias='c')
        cur.execute(
            f"{base_query} WHERE {where_frag} ORDER BY c.updated_at DESC",
            where_params,
        )
        rows = cur.fetchall()
        print(f"[DEBUG] handle_list_clients: account_role={user.get('account_role')}, user_id={user.get('user_id')}, rows_returned={len(rows)}")
        cur.close()
        conn.close()

        clients = []
        for row in rows:
            icon_s3_key = row[10]
            icon_url = None
            if icon_s3_key:
                try:
                    icon_url = s3_client.generate_presigned_url(
                        'get_object',
                        Params={'Bucket': BUCKET_NAME, 'Key': icon_s3_key},
                        ExpiresIn=3600
                    )
                except Exception:
                    pass

            clients.append({
                'id': str(row[0]),
                'company_name': row[1] or '',
                'industry': row[2] or '',
                'client_id': row[3] or '',
                'status': row[4] or 'active',
                'created_at': row[5].isoformat() if row[5] else None,
                'updated_at': row[6].isoformat() if row[6] else None,
                'source_count': row[7] or 0,
                'enrichment_status': row[8] or 'none',
                'enrichment_date': row[9].isoformat() if row[9] else None,
                'icon_url': icon_url,
                'owner_name': row[11] or '',
                'account_name': row[12] or '',
                'account_id': row[13],
                'intellagentic_lead': bool(row[14]),
                'updated_by': row[15] or '',
                'ndaSigned': bool(row[16]),
                'existingApps': row[17] or '',
                'ndaSignedAt': row[18].isoformat() if row[18] else None
            })

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'clients': clients})
        }

    except Exception as e:
        print(f"Error listing clients: {str(e)}")
        cur.close()
        conn.close()
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Internal server error', 'message': str(e)})
        }


def handle_get_client(event, user):
    """GET /clients?client_id=X — Fetch existing client data."""
    params = event.get('queryStringParameters') or {}
    client_id = params.get('client_id', '').strip()

    conn = get_db_connection()
    cur = conn.cursor()

    try:
        # Client-token users: force scope to their client
        if user.get('is_client') and user.get('client_id'):
            client_id = user['client_id']

        if client_id:
            base_select = """
                SELECT id, company_name, website_url, contact_name, contact_title,
                       contact_linkedin, industry, description, pain_point,
                       s3_folder, created_at, updated_at, logo_s3_key, icon_s3_key,
                       COALESCE(streamline_webhook_enabled, FALSE),
                       contact_email, contact_phone, contacts_json, addresses_json,
                       streamline_webhook_url, account_id, COALESCE(intellagentic_lead, FALSE),
                       future_plans, pain_points_json, invite_webhook_url,
                       encryption_key, updated_by,
                       COALESCE(nda_signed, FALSE), existing_apps, nda_signed_at,
                       approved_at, company_linkedin, poc_scope
                FROM clients
            """
            # PR 3.4: helper covers every JWT role including the cross-tenant
            # share path for account_admin. base_select uses unaliased
            # `FROM clients`, so we pass alias='clients' to the helper.
            where_frag, where_params = clients_where_fragment(user, alias='clients')
            cur.execute(
                f"{base_select} WHERE s3_folder = %s AND ({where_frag})",
                (client_id,) + where_params,
            )
        else:
            # Fetch most recent client for this user
            cur.execute("""
                SELECT id, company_name, website_url, contact_name, contact_title,
                       contact_linkedin, industry, description, pain_point,
                       s3_folder, created_at, updated_at, logo_s3_key, icon_s3_key,
                       COALESCE(streamline_webhook_enabled, FALSE),
                       contact_email, contact_phone, contacts_json, addresses_json,
                       streamline_webhook_url, account_id, COALESCE(intellagentic_lead, FALSE),
                       future_plans, pain_points_json, invite_webhook_url,
                       encryption_key, updated_by,
                       COALESCE(nda_signed, FALSE), existing_apps, nda_signed_at,
                       approved_at
                FROM clients WHERE user_id = %s
                ORDER BY created_at DESC LIMIT 1
            """, (user['user_id'],))

        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            return {
                'statusCode': 404,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'No client found'})
            }

        # Unwrap per-client encryption key
        ck = unwrap_client_key(row[25]) if len(row) > 25 and row[25] else None

        logo_s3_key = row[12]
        icon_s3_key = row[13]
        logo_url = None
        icon_url = None

        if logo_s3_key:
            try:
                logo_url = s3_client.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': BUCKET_NAME, 'Key': logo_s3_key},
                    ExpiresIn=3600
                )
            except Exception:
                pass

        if icon_s3_key:
            try:
                icon_url = s3_client.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': BUCKET_NAME, 'Key': icon_s3_key},
                    ExpiresIn=3600
                )
            except Exception:
                pass

        # Build contacts array: prefer contacts_json, fallback to legacy columns
        contacts_json_raw = row[17]
        if contacts_json_raw:
            try:
                contacts = json.loads(contacts_json_raw) if isinstance(contacts_json_raw, str) else contacts_json_raw
                if not contacts:
                    contacts = []
            except (json.JSONDecodeError, TypeError):
                contacts = []
        else:
            contacts = []

        if not contacts:
            # Construct from legacy fields — split name into firstName/lastName
            full_name = row[3] or ''
            space_idx = full_name.find(' ')
            legacy = {
                'firstName': full_name[:space_idx] if space_idx > 0 else full_name,
                'lastName': full_name[space_idx + 1:] if space_idx > 0 else '',
                'title': row[4] or '',
                'linkedin': row[5] or '',
                'email': row[15] or '',
                'phone': row[16] or ''
            }
            if any(legacy.values()):
                contacts = [legacy]

        # Migrate any contacts that still have "name" instead of firstName/lastName
        for c in contacts:
            if 'name' in c and 'firstName' not in c:
                old_name = c.pop('name', '')
                space_idx = old_name.find(' ')
                c['firstName'] = old_name[:space_idx] if space_idx > 0 else old_name
                c['lastName'] = old_name[space_idx + 1:] if space_idx > 0 else ''

        # Resolve contact photo S3 keys to fresh presigned URLs
        contacts = _resolve_contact_photos(contacts)

        # Parse addresses_json
        addresses_json_raw = row[18]
        addresses = []
        if addresses_json_raw:
            try:
                addresses = json.loads(addresses_json_raw) if isinstance(addresses_json_raw, str) else addresses_json_raw
                if not addresses:
                    addresses = []
            except (json.JSONDecodeError, TypeError):
                pass

        # Legacy flat fields from contacts[0] for backward compat
        primary = contacts[0] if contacts else {}

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({
                'id': str(row[0]),
                'company_name': row[1] or '',
                'website': row[2] or '',
                'contactName': f"{primary.get('firstName', '')} {primary.get('lastName', '')}".strip(),
                'contactTitle': primary.get('title', ''),
                'contactLinkedIn': primary.get('linkedin', ''),
                'industry': row[6] or '',
                'description': row[7] or '',
                'painPoint': row[8] or '',
                'futurePlans': row[22] or '',
                'painPoints': json.loads(row[23]) if row[23] else [],
                'client_id': row[9] or '',
                'created_at': row[10].isoformat() if row[10] else None,
                'updated_at': row[11].isoformat() if row[11] else None,
                'logo_url': logo_url,
                'icon_url': icon_url,
                'streamline_webhook_enabled': bool(row[14]),
                'contactEmail': primary.get('email', ''),
                'contactPhone': primary.get('phone', ''),
                'contacts': contacts,
                'addresses': addresses,
                'streamline_webhook_url': row[19] or '',
                'account_id': row[20],
                'intellagentic_lead': bool(row[21]),
                'invite_webhook_url': row[24] or '',
                'updated_by': (row[26] or '') if len(row) > 26 else '',
                'ndaSigned': bool(row[27]) if len(row) > 27 else False,
                'existingApps': (row[28] or '') if len(row) > 28 else '',
                'ndaSignedAt': row[29].isoformat() if len(row) > 29 and row[29] else None,
                'approved_at': row[30].isoformat() if len(row) > 30 and row[30] else None,
                'company_linkedin': (row[31] or '') if len(row) > 31 else '',
                'poc_scope': row[32] if len(row) > 32 else None
            })
        }
    except Exception as e:
        print(f"Error fetching client: {str(e)}")
        cur.close()
        conn.close()
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Internal server error', 'message': str(e)})
        }


def handle_update_client(event, user):
    """PUT /clients — Update existing client."""
    try:
        body = json.loads(event.get('body', '{}'))
        client_id = body.get('client_id', '').strip()

        if not client_id:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'client_id is required'})
            }

        company_name = body.get('company_name', '').strip()
        if not company_name:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'company_name is required'})
            }

        # Build contacts array from request
        contacts = body.get('contacts', [])
        if not contacts:
            # Fallback: construct from legacy flat fields if provided
            legacy = {
                'firstName': body.get('contactName', '').strip(),
                'lastName': '',
                'title': body.get('contactTitle', '').strip(),
                'linkedin': body.get('contactLinkedIn', '').strip(),
                'email': body.get('contactEmail', '').strip(),
                'phone': body.get('contactPhone', '').strip()
            }
            if any(legacy.values()):
                contacts = [legacy]

        # Build addresses array from request
        addresses = body.get('addresses', [])

        # Sync primary contact to legacy columns
        primary = contacts[0] if contacts else {}

        conn = get_db_connection()
        cur = conn.cursor()

        # Get client's encryption key
        ck = _get_client_key(cur, client_id)

        # Build dynamic SET clause — streamline_webhook_enabled is optional
        set_fields = [
            "company_name = %s", "website_url = %s", "contact_name = %s",
            "contact_title = %s", "contact_linkedin = %s",
            "contact_email = %s", "contact_phone = %s",
            "contacts_json = %s", "addresses_json = %s",
            "industry = %s",
            "description = %s", "pain_point = %s",
            "future_plans = %s", "pain_points_json = %s",
            "updated_at = NOW()", "updated_by = %s"
        ]
        pain_points = body.get('painPoints', [])
        params = [
            company_name,
            body.get('website', '').strip(),
            f"{primary.get('firstName', '')} {primary.get('lastName', '')}".strip(),
            primary.get('title', ''),
            primary.get('linkedin', ''),
            primary.get('email', ''),
            primary.get('phone', ''),
            json.dumps(contacts) if contacts else None,
            json.dumps(addresses) if addresses else None,
            body.get('industry', '').strip(),
            body.get('description', '').strip(),
            body.get('painPoint', '').strip(),
            body.get('futurePlans', '').strip(),
            json.dumps(pain_points) if pain_points else None,
            user.get('name', '') or user.get('email', ''),
        ]

        if 'streamline_webhook_enabled' in body:
            set_fields.append("streamline_webhook_enabled = %s")
            params.append(bool(body['streamline_webhook_enabled']))

        if 'streamline_webhook_url' in body:
            set_fields.append("streamline_webhook_url = %s")
            params.append(body['streamline_webhook_url'].strip())

        if 'invite_webhook_url' in body:
            set_fields.append("invite_webhook_url = %s")
            params.append(body['invite_webhook_url'].strip())

        if 'account_id' in body:
            set_fields.append("account_id = %s")
            params.append(body['account_id'])  # int or None

        if 'intellagentic_lead' in body:
            set_fields.append("intellagentic_lead = %s")
            params.append(bool(body['intellagentic_lead']))

        if 'ndaSigned' in body:
            nda_val = bool(body['ndaSigned'])
            set_fields.append("nda_signed = %s")
            params.append(nda_val)
            if nda_val:
                set_fields.append("nda_signed_at = NOW()")
            else:
                set_fields.append("nda_signed_at = NULL")

        if 'approved' in body:
            if body['approved']:
                set_fields.append("approved_at = NOW()")
                set_fields.append("approved_by = %s")
                params.append(user.get('name', '') or user.get('email', ''))
            else:
                set_fields.append("approved_at = NULL")
                set_fields.append("approved_by = NULL")

        if 'existingApps' in body:
            set_fields.append("existing_apps = %s")
            params.append(body['existingApps'].strip())

        if 'company_linkedin' in body:
            set_fields.append("company_linkedin = %s")
            params.append(body['company_linkedin'].strip())

        # PR 3.4: writes require write-access (owner OR 'read_write' share).
        # Helper produces the WHERE fragment; we append it to the UPDATE.
        # Note: this is a write, so for share users it requires 'read_write'
        # — but the WHERE fragment alone doesn't enforce that. The schema-
        # level guard is in can_user_access_client used elsewhere; for UPDATE
        # we additionally check the share permission in the WHERE clause by
        # gating on (account_admin in owning account) OR (read_write share).
        where_frag, where_params = clients_where_fragment(user, alias='clients')
        # For writers, narrow the share branch to read_write only when the
        # WHERE fragment includes shares. Cleanest: re-run the write check
        # via can_user_access_client to bail early before constructing the
        # SQL, then use s3_folder match (helper still enforces ownership).
        # Look up the client_id by s3_folder first to call the helper.
        cur.execute("SELECT id FROM clients WHERE s3_folder = %s", (client_id,))
        id_row = cur.fetchone()
        if not id_row:
            cur.close()
            conn.close()
            return {
                'statusCode': 404,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Client not found'}),
            }
        if not can_user_access_client(conn, user, id_row[0], write=True):
            cur.close()
            conn.close()
            return {
                'statusCode': 403,
                'headers': CORS_HEADERS,
                'body': json.dumps({
                    'error': 'You do not have write access to this client. '
                             'A read_only share grant cannot perform writes.'
                }),
            }

        params.extend((client_id,) + where_params)
        cur.execute(f"""
            UPDATE clients SET {', '.join(set_fields)}
            WHERE s3_folder = %s AND ({where_frag})
            RETURNING id
        """, params)

        row = cur.fetchone()
        conn.commit()

        # Regenerate client-config.md in S3
        s3_enc = is_s3_encryption_enabled(cur)
        config_md = generate_client_config(
            company_name,
            body.get('website', '').strip(),
            f"{primary.get('firstName', '')} {primary.get('lastName', '')}".strip(),
            primary.get('title', ''),
            primary.get('linkedin', ''),
            body.get('industry', '').strip(),
            body.get('description', '').strip(),
            body.get('painPoint', '').strip(),
            contact_email=primary.get('email', ''),
            contact_phone=primary.get('phone', ''),
            contacts=contacts,
            addresses=addresses,
            future_plans=body.get('futurePlans', '').strip(),
            pain_points=pain_points
        )
        s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=f"{client_id}/client-config.md",
            Body=maybe_encrypt_s3_body(ck, config_md, enabled=s3_enc),
            ContentType='application/octet-stream'
        )

        cur.close()
        conn.close()

        if not row:
            return {
                'statusCode': 404,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Client not found'})
            }

        print(f"Updated client: {client_id}")
        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({
                'client_id': client_id,
                'id': str(row[0]),
                'status': 'updated'
            })
        }

    except Exception as e:
        print(f"Error updating client: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Internal server error', 'message': str(e)})
        }


def handle_proxy(event, user):
    """POST /proxy — Forward a JSON POST to an external URL (avoids CORS).
    Body: { target_url: "https://...", payload: {...} }
    Only allows HTTPS URLs to whitelisted domains."""
    try:
        body = json.loads(event.get('body', '{}'))
        target_url = body.get('target_url', '').strip()
        payload = body.get('payload', {})

        if not target_url:
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'target_url is required'})}

        # Whitelist: only allow known domains
        allowed_domains = ['us.streamline.intellistack.ai', 'eu.streamline.intellistack.ai', 'streamline.intellistack.ai']
        from urllib.parse import urlparse
        parsed = urlparse(target_url)
        if parsed.hostname not in allowed_domains:
            return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': f'Domain not allowed: {parsed.hostname}'})}
        if parsed.scheme != 'https':
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Only HTTPS URLs are allowed'})}

        # Forward the request
        json_bytes = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            target_url,
            data=json_bytes,
            headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp_body = resp.read().decode('utf-8', errors='replace')
            resp_status = resp.status

        # Try to parse as JSON, fallback to raw text
        try:
            resp_data = json.loads(resp_body)
        except (json.JSONDecodeError, TypeError):
            resp_data = {'raw': resp_body}

        return {
            'statusCode': resp_status,
            'headers': CORS_HEADERS,
            'body': json.dumps(resp_data)
        }

    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8', errors='replace')
        print(f"Proxy target error: HTTP {e.code} - {error_body}")
        return {'statusCode': e.code, 'headers': CORS_HEADERS, 'body': json.dumps({'error': error_body})}
    except Exception as e:
        print(f"Proxy error: {str(e)}")
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}


def handle_get_scope(event, user):
    """GET /clients?action=scope&engagement_id=X — Return POC scope for an engagement."""
    params = event.get('queryStringParameters') or {}
    engagement_id = params.get('engagement_id', '').strip()
    client_id = params.get('client_id', '').strip()
    if not engagement_id and not client_id:
        return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'engagement_id or client_id required'})}
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        if engagement_id:
            cur.execute("SELECT poc_scope FROM engagements WHERE id = %s", (engagement_id,))
        else:
            # Fallback: read from client-level poc_scope (legacy)
            cur.execute("SELECT poc_scope FROM clients WHERE s3_folder = %s", (client_id,))
        row = cur.fetchone()
        cur.close()
        conn.close()
        if not row:
            return {'statusCode': 404, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Not found'})}
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({'poc_scope': row[0]})}
    except Exception as e:
        print(f"Error getting scope: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}


def handle_update_scope(event, user):
    """PUT /clients?action=scope — Set POC scope for an engagement (or client fallback)."""
    try:
        body = json.loads(event.get('body', '{}'))
        engagement_id = body.get('engagement_id', '').strip()
        client_id = body.get('client_id', '').strip()
        if not engagement_id and not client_id:
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'engagement_id or client_id required'})}

        scope_data = {
            'problems': body.get('problems', []),
            'new_components': body.get('new_components', []),
            'scoped_at': datetime.now(timezone.utc).isoformat(),
            'scoped_by': user.get('email', ''),
        }

        conn = get_db_connection()
        cur = conn.cursor()
        if engagement_id:
            cur.execute(
                "UPDATE engagements SET poc_scope = %s, scope_review_needed = FALSE WHERE id = %s RETURNING id",
                (json.dumps(scope_data), engagement_id)
            )
        else:
            cur.execute(
                "UPDATE clients SET poc_scope = %s WHERE s3_folder = %s RETURNING id",
                (json.dumps(scope_data), client_id)
            )
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return {'statusCode': 404, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Not found'})}
        conn.commit()
        cur.close()
        conn.close()
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({'poc_scope': scope_data})}
    except Exception as e:
        print(f"Error updating scope: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}


def handle_delete_client(event, user):
    """DELETE /clients?client_id=X — Delete client and all associated data."""
    try:
        params = event.get('queryStringParameters') or {}
        client_id = params.get('client_id', '').strip()

        if not client_id:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'client_id is required'})
            }

        conn = get_db_connection()
        cur = conn.cursor()

        # Verify ownership and get DB id (admins can access any client)
        if user.get('is_admin'):
            cur.execute("SELECT id FROM clients WHERE s3_folder = %s", (client_id,))
        else:
            cur.execute("SELECT id FROM clients WHERE s3_folder = %s AND user_id = %s", (client_id, user['user_id']))
        row = cur.fetchone()

        if not row:
            cur.close()
            conn.close()
            return {
                'statusCode': 404,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Client not found'})
            }

        # Delete from DB (cascades to uploads, enrichments, skills)
        cur.execute("DELETE FROM clients WHERE id = %s", (row[0],))
        conn.commit()
        cur.close()
        conn.close()

        # Delete S3 folder and all contents
        try:
            paginator = s3_client.get_paginator('list_objects_v2')
            for page in paginator.paginate(Bucket=BUCKET_NAME, Prefix=f"{client_id}/"):
                objects = page.get('Contents', [])
                if objects:
                    s3_client.delete_objects(
                        Bucket=BUCKET_NAME,
                        Delete={'Objects': [{'Key': obj['Key']} for obj in objects]}
                    )
            print(f"Deleted S3 folder: {client_id}/")
        except Exception as e:
            print(f"Warning: failed to delete S3 folder {client_id}/: {e}")

        print(f"Deleted client: {client_id}")
        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'deleted': True, 'client_id': client_id})
        }

    except Exception as e:
        print(f"Error deleting client: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Internal server error', 'message': str(e)})
        }


def handle_get_system_config(event, user):
    """GET /system-config — Return all system config key/value pairs."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT config_key, config_value FROM system_config")
        rows = cur.fetchall()
        cur.close()
        conn.close()
        config = {row[0]: row[1] or '' for row in rows}
        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps(config)
        }
    except Exception as e:
        print(f"Error fetching system config: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Internal server error', 'message': str(e)})}


def handle_update_system_config(event, user):
    """PUT /system-config — Upsert a system config key/value pair."""
    try:
        body = json.loads(event.get('body', '{}'))
        config_key = body.get('config_key', '').strip()
        config_value = body.get('config_value', '').strip()

        if not config_key:
            return {'statusCode': 400, 'headers': CORS_HEADERS,
                    'body': json.dumps({'error': 'config_key is required'})}

        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO system_config (config_key, config_value, updated_at)
            VALUES (%s, %s, NOW())
            ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()
        """, (config_key, config_value))
        conn.commit()
        cur.close()
        conn.close()

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'status': 'saved', 'config_key': config_key})
        }
    except Exception as e:
        print(f"Error updating system config: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Internal server error', 'message': str(e)})}


def handle_s3_encryption_convert(event, user):
    """POST /system-config/s3-encryption-convert — Bulk encrypt or decrypt all S3 files for all clients.
    Body: { "action": "encrypt" | "decrypt" }
    Admin only. Returns per-client progress."""
    try:
        body = json.loads(event.get('body', '{}'))
        action = body.get('action', '').strip()

        if action not in ('encrypt', 'decrypt'):
            return {'statusCode': 400, 'headers': CORS_HEADERS,
                    'body': json.dumps({'error': 'action must be "encrypt" or "decrypt"'})}

        conn = get_db_connection()
        cur = conn.cursor()

        cur.execute("SELECT id, company_name, s3_folder, encryption_key FROM clients WHERE deleted_at IS NULL")
        clients = cur.fetchall()
        total = len(clients)
        results = []

        for idx, (db_id, company_name, s3_folder, enc_key_raw) in enumerate(clients):
            client_result = {
                'client_id': str(db_id),
                'company_name': company_name or '',
                'status': 'processing',
                'files_converted': 0,
                'errors': []
            }

            if not s3_folder:
                client_result['status'] = 'skipped'
                client_result['reason'] = 'no s3_folder'
                results.append(client_result)
                continue

            ck = unwrap_client_key(enc_key_raw) if enc_key_raw else None
            if not ck:
                client_result['status'] = 'skipped'
                client_result['reason'] = 'no encryption key'
                results.append(client_result)
                continue

            try:
                s3 = boto3.client('s3')
                prefix = f"{s3_folder}/"
                paginator = s3.get_paginator('list_objects_v2')
                files_converted = 0

                for page in paginator.paginate(Bucket=BUCKET_NAME, Prefix=prefix):
                    for obj in page.get('Contents', []):
                        key = obj['Key']
                        if key.endswith('/'):
                            continue
                        try:
                            response = s3.get_object(Bucket=BUCKET_NAME, Key=key)
                            raw = response['Body'].read()

                            if action == 'decrypt':
                                # Text files with ENC: prefix
                                try:
                                    body_str = raw.decode('utf-8', errors='ignore')
                                    if body_str.startswith('ENC:'):
                                        decrypted = decrypt_s3_body(ck, body_str)
                                        s3.put_object(Bucket=BUCKET_NAME, Key=key, Body=decrypted.encode('utf-8'))
                                        files_converted += 1
                                        continue
                                except Exception:
                                    pass
                                # Binary files with ENCB: prefix
                                if raw[:5] == b'ENCB:':
                                    decrypted = decrypt_s3_bytes(ck, raw)
                                    s3.put_object(Bucket=BUCKET_NAME, Key=key, Body=decrypted)
                                    files_converted += 1

                            elif action == 'encrypt':
                                # Skip already encrypted
                                try:
                                    body_str = raw.decode('utf-8', errors='ignore')
                                    if body_str.startswith('ENC:'):
                                        continue
                                except Exception:
                                    pass
                                if raw[:5] == b'ENCB:':
                                    continue
                                # Determine text vs binary
                                is_text = any(key.endswith(ext) for ext in ('.md', '.json', '.txt', '.csv'))
                                if is_text:
                                    encrypted = encrypt_s3_body(ck, raw.decode('utf-8', errors='replace'))
                                    s3.put_object(Bucket=BUCKET_NAME, Key=key, Body=encrypted)
                                    files_converted += 1
                                else:
                                    encrypted = encrypt_s3_bytes(ck, raw)
                                    s3.put_object(Bucket=BUCKET_NAME, Key=key, Body=encrypted)
                                    files_converted += 1

                        except Exception as e:
                            client_result['errors'].append(f"{key}: {str(e)}")

                client_result['files_converted'] = files_converted
                client_result['status'] = 'done'

            except Exception as e:
                client_result['status'] = 'error'
                client_result['errors'].append(str(e))

            results.append(client_result)
            print(f"S3 {action}: {company_name} — {client_result['files_converted']} files ({idx + 1}/{total})")

        # Update the toggle
        new_value = 'true' if action == 'encrypt' else 'false'
        cur.execute("""
            INSERT INTO system_config (config_key, config_value, updated_at)
            VALUES ('s3_encryption_enabled', %s, NOW())
            ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()
        """, (new_value,))
        conn.commit()
        cur.close()
        conn.close()

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({
                'action': action,
                'total_clients': total,
                'results': results,
                's3_encryption_enabled': new_value == 'true'
            })
        }

    except Exception as e:
        print(f"S3 encryption convert error: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS,
                'body': json.dumps({'error': str(e)})}


def handle_invite(event):
    """POST /invite — Public invite signup (no auth). Creates client + magic link."""
    try:
        body = json.loads(event.get('body', '{}'))
        first_name = body.get('first_name', '').strip()
        last_name = body.get('last_name', '').strip()
        email = body.get('email', '').strip()
        phone = body.get('phone', '').strip()
        linkedin = body.get('linkedin', '').strip()
        company_name = body.get('company_name', '').strip()
        lead_source = body.get('lead_source', '').strip()
        contact_name = f"{first_name} {last_name}".strip()

        if not first_name or not email or not phone or not company_name:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'first_name, email, phone, and company_name are required'})
            }

        conn = get_db_connection()
        cur = conn.cursor()

        # Check for existing invite by email
        cur.execute("""
            SELECT c.id, c.s3_folder, ct.token
            FROM clients c
            LEFT JOIN client_tokens ct ON ct.client_id = c.id AND ct.expires_at > NOW()
            WHERE c.contact_email = %s AND c.source = 'invite'
            LIMIT 1
        """, (email,))
        existing = cur.fetchone()

        if existing:
            db_id, s3_folder, token = existing
            if token:
                # Look up invite webhook URL from system_config
                sys_invite_url = ''
                try:
                    cur.execute("SELECT config_value FROM system_config WHERE config_key = 'invite_webhook_url'")
                    sys_row = cur.fetchone()
                    if sys_row:
                        sys_invite_url = sys_row[0] or ''
                except Exception:
                    pass
                cur.close()
                conn.close()
                print(f"Invite signup (existing): {company_name} ({email})")
                _send_invite_webhook(company_name, first_name, last_name, email, phone, linkedin, lead_source=lead_source, webhook_url=sys_invite_url)
                return {
                    'statusCode': 200,
                    'headers': CORS_HEADERS,
                    'body': json.dumps({
                        'success': True,
                        'company_name': company_name,
                        'existing': True
                    })
                }
            # Token expired — generate new one below
            db_client_id = db_id
            client_id = s3_folder
        else:
            # Create new client
            timestamp = str(int(time.time()))
            name_hash = hashlib.md5(company_name.encode()).hexdigest()[:8]
            client_id = f"client_{timestamp}_{name_hash}"

            # Generate per-client encryption key
            encrypted_client_key = generate_client_key()
            ck = unwrap_client_key(encrypted_client_key)

            # S3 folders
            for folder in [f"{client_id}/uploads/", f"{client_id}/extracted/", f"{client_id}/results/"]:
                s3_client.put_object(Bucket=BUCKET_NAME, Key=folder, Body='')

            # Client config (optionally encrypted with client key)
            s3_enc = is_s3_encryption_enabled(cur)
            config_md = generate_client_config(
                company_name, '', contact_name, '', linkedin, '', '', '',
                contact_email=email, contact_phone=phone
            )
            s3_client.put_object(
                Bucket=BUCKET_NAME, Key=f"{client_id}/client-config.md",
                Body=maybe_encrypt_s3_body(ck, config_md, enabled=s3_enc), ContentType='application/octet-stream'
            )

            # Default skill
            copy_default_skill(client_id, client_key=ck, s3_enc=s3_enc)

            # Insert client with user_id=NULL, source='invite'
            cur.execute("""
                INSERT INTO clients (
                    user_id, company_name, contact_name, contact_email,
                    contact_phone, contact_linkedin, s3_folder, source,
                    encryption_key
                ) VALUES (NULL, %s, %s, %s, %s, %s, %s, 'invite', %s)
                RETURNING id
            """, (company_name, contact_name, email, phone, linkedin, client_id, encrypted_client_key))
            db_client_id = cur.fetchone()[0]

            # Insert default skill into DB
            cur.execute("""
                INSERT INTO skills (client_id, name, s3_key)
                VALUES (%s, %s, %s)
            """, (str(db_client_id), 'analysis-template', f"{client_id}/skills/analysis-template.md"))

        # Generate magic link token
        new_token = secrets.token_hex(32)
        expires_at = datetime.now(timezone.utc) + timedelta(days=30)
        cur.execute("""
            INSERT INTO client_tokens (token, client_id, expires_at, created_by)
            VALUES (%s, %s, %s, NULL)
        """, (new_token, db_client_id, expires_at))

        conn.commit()
        cur.close()
        conn.close()

        magic_link_url = f"{FRONTEND_URL}?token={new_token}"
        print(f"Invite signup: {company_name} ({email}) -> {client_id}")

        # Look up configured invite webhook URL from system_config
        invite_url = ''
        try:
            wh_conn = get_db_connection()
            wh_cur = wh_conn.cursor()
            wh_cur.execute("SELECT config_value FROM system_config WHERE config_key = 'invite_webhook_url'")
            wh_row = wh_cur.fetchone()
            if wh_row:
                invite_url = wh_row[0] or ''
            wh_cur.close()
            wh_conn.close()
        except Exception as e:
            print(f"Failed to look up invite webhook URL from system_config (non-fatal): {e}")

        # Fire webhook (best-effort)
        _send_invite_webhook(company_name, first_name, last_name, email, phone, linkedin, lead_source=lead_source, webhook_url=invite_url)

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({
                'success': True,
                'company_name': company_name
            })
        }

    except Exception as e:
        print(f"Invite error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Internal server error', 'message': str(e)})
        }


def _send_invite_webhook(company_name, first_name, last_name, email, phone, linkedin, lead_source='', webhook_url=''):
    """Best-effort POST to Streamline invite webhook. Uses per-client URL if provided, falls back to env var."""
    url = webhook_url or STREAMLINE_INVITE_WEBHOOK_URL
    if not url:
        print("No invite webhook URL configured (no per-client URL or env var), skipping")
        return
    try:
        payload = json.dumps({
            'event': 'invite_submission',
            'source': 'himss_2026',
            'first_name': first_name,
            'last_name': last_name,
            'email': email,
            'phone': phone,
            'linkedin': linkedin,
            'company_name': company_name,
            'lead_source': lead_source,
            'signup_date': datetime.now(timezone.utc).isoformat()
        }).encode('utf-8')
        req = urllib.request.Request(
            url,
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        resp = urllib.request.urlopen(req, timeout=5)
        print(f"Invite webhook sent for {email} to {url} (HTTP {resp.status})")
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        print(f"Invite webhook failed (non-fatal): HTTP {e.code} - {body}")
    except Exception as e:
        print(f"Invite webhook failed (non-fatal): {e}")


def handle_create_client(event, user):
    """POST /clients — Create new client (original logic)."""
    try:
        # Parse request body
        body = json.loads(event.get('body', '{}'))
        company_name = body.get('company_name', '').strip()
        website = body.get('website', '').strip()
        industry = body.get('industry', '').strip()
        description = body.get('description', '').strip()
        pain_point = body.get('painPoint', '').strip()
        future_plans = body.get('futurePlans', '').strip()
        pain_points = body.get('painPoints', [])

        # Build contacts array
        contacts = body.get('contacts', [])
        if not contacts:
            legacy = {
                'firstName': body.get('contactName', '').strip(),
                'lastName': '',
                'title': body.get('contactTitle', '').strip(),
                'linkedin': body.get('contactLinkedIn', '').strip(),
                'email': body.get('contactEmail', '').strip(),
                'phone': body.get('contactPhone', '').strip()
            }
            if any(legacy.values()):
                contacts = [legacy]

        # Build addresses array
        addresses = body.get('addresses', [])

        primary = contacts[0] if contacts else {}
        contact_name = f"{primary.get('firstName', '')} {primary.get('lastName', '')}".strip()
        contact_title = primary.get('title', '')
        contact_linkedin = primary.get('linkedin', '')
        contact_email = primary.get('email', '')
        contact_phone = primary.get('phone', '')

        # Validate required fields
        if not company_name:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'company_name is required'})
            }

        # Generate unique client_id (S3 folder name)
        timestamp = str(int(time.time()))
        name_hash = hashlib.md5(company_name.encode()).hexdigest()[:8]
        client_id = f"client_{timestamp}_{name_hash}"

        # Generate per-client encryption key
        encrypted_client_key = generate_client_key()
        ck = unwrap_client_key(encrypted_client_key)  # raw key for S3 encryption

        # Create folder structure in S3
        folders = [
            f"{client_id}/uploads/",
            f"{client_id}/extracted/",
            f"{client_id}/results/"
        ]

        for folder in folders:
            s3_client.put_object(Bucket=BUCKET_NAME, Key=folder, Body='')

        # Generate client-config.md (optionally encrypted with client key)
        conn_tmp = get_db_connection()
        cur_tmp = conn_tmp.cursor()
        s3_enc = is_s3_encryption_enabled(cur_tmp)
        cur_tmp.close()
        conn_tmp.close()
        config_md = generate_client_config(
            company_name, website, contact_name, contact_title,
            contact_linkedin, industry, description, pain_point,
            contact_email=contact_email, contact_phone=contact_phone,
            contacts=contacts, addresses=addresses,
            future_plans=future_plans, pain_points=pain_points
        )
        s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=f"{client_id}/client-config.md",
            Body=maybe_encrypt_s3_body(ck, config_md, enabled=s3_enc),
            ContentType='application/octet-stream'
        )

        # Copy default skill template to client's skills folder
        copy_default_skill(client_id, client_key=ck, s3_enc=s3_enc)

        # Insert into PostgreSQL
        conn = get_db_connection()
        cur = conn.cursor()

        # Accounts auto-assign their account_id to new clients
        account_id_val = body.get('account_id')  # int or None
        if user.get('is_account') and user.get('account_id'):
            account_id_val = user['account_id']
        intellagentic_lead_val = bool(body.get('intellagentic_lead', False))

        cur.execute("""
            INSERT INTO clients (
                user_id, company_name, website_url, contact_name, contact_title,
                contact_linkedin, contact_email, contact_phone,
                contacts_json, addresses_json, industry, description, pain_point, s3_folder,
                account_id, intellagentic_lead, future_plans, pain_points_json,
                encryption_key, updated_by, nda_signed, nda_signed_at, existing_apps, company_linkedin
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (
            user['user_id'], company_name, website,
            contact_name, contact_title,
            contact_linkedin, contact_email, contact_phone,
            json.dumps(contacts) if contacts else None,
            json.dumps(addresses) if addresses else None,
            industry, description, pain_point, client_id,
            account_id_val, intellagentic_lead_val,
            future_plans,
            json.dumps(pain_points) if pain_points else None,
            encrypted_client_key,
            user.get('name', '') or user.get('email', ''),
            bool(body.get('ndaSigned', False)),
            datetime.now(timezone.utc) if body.get('ndaSigned', False) else None,
            body.get('existingApps', '').strip(),
            body.get('company_linkedin', '').strip()
        ))

        db_id = str(cur.fetchone()[0])

        # Auto-grant UCA so creator can immediately open + edit the client they made.
        # Idempotent on (user_id, client_id) unique constraint.
        cur.execute("""
            INSERT INTO user_client_assignments (user_id, client_id, assigned_by)
            VALUES (%s, %s, %s)
            ON CONFLICT (user_id, client_id) DO NOTHING
        """, (user['user_id'], db_id, user['user_id']))

        # Insert default skill into DB so it shows in Skills screen
        cur2 = conn.cursor()
        cur2.execute("""
            INSERT INTO skills (client_id, name, s3_key)
            VALUES (%s, %s, %s)
        """, (db_id, 'analysis-template', f"{client_id}/skills/analysis-template.md"))
        conn.commit()
        cur2.close()
        conn.close()

        print(f"Created client: {client_id} (db: {db_id}) for company: {company_name}")

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({
                'client_id': client_id,
                'id': db_id,
                'status': 'created'
            })
        }

    except Exception as e:
        print(f"Error creating client: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }


DEFAULT_SKILL_TEMPLATE = """# Analysis Skill -- Default Template

Edit this skill to customize how Claude analyzes this client's data. Each section shapes a different aspect of the analysis.

---

## Context

Who is this client? What do they do? What stage are they at?

- Industry:
- Business model:
- Company size:
- Key stakeholders:

---

## Focus Areas

What metrics, problems, or themes should the analysis prioritize?

1. Revenue and cash flow patterns
2. Operational bottlenecks
3. Customer acquisition and retention
4. Process inefficiencies
5. Data quality and gaps

---

## Ignore List

What should the analysis skip or de-prioritize?

- Do not focus on branding or marketing aesthetics
- Do not recommend complete platform rebuilds
- Do not speculate about competitor strategies without data

---

## Output Format

How should findings be structured?

- Lead with the single biggest insight -- the thing the CEO needs to hear Monday morning
- Use ASCII diagrams for any proposed system architecture
- Present database schemas as formatted tables (name | type | description)
- Number all recommendations and tie each to specific evidence from the data
- End with a concrete bottom line: what to do first and what it will cost

---

## Authority Boundaries

What should Claude recommend directly vs. flag for human review?

### Recommend Directly
- Process improvements based on clear data patterns
- Data schema designs based on the uploaded documents
- Quick wins achievable within 30 days
- Metrics to start tracking immediately

### Flag for Human Review
- Any recommendation requiring >$10K investment
- Staffing changes or organizational restructuring
- Technology platform migrations
- Regulatory or compliance-related decisions
- Anything requiring legal review
"""


def copy_default_skill(client_id, client_key=None, s3_enc=True):
    """Copy the default skill template to the client's skills folder in S3."""
    try:
        body = DEFAULT_SKILL_TEMPLATE.strip()
        if client_key and s3_enc:
            body = encrypt_s3_body(client_key, body)
            content_type = 'application/octet-stream'
        else:
            body = body.encode('utf-8')
            content_type = 'text/markdown'
        s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=f"{client_id}/skills/analysis-template.md",
            Body=body,
            ContentType=content_type
        )
        print(f"Copied default skill to {client_id}/skills/analysis-template.md")
    except Exception as e:
        print(f"Error copying default skill: {e}")


def generate_client_config(company_name, website, contact_name, contact_title,
                           contact_linkedin, industry, description, pain_point,
                           contact_email='', contact_phone='', contacts=None, addresses=None,
                           future_plans='', pain_points=None):
    """Generate a client-config.md structured context document."""
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    sections = []
    sections.append(f"# Client Configuration -- {company_name}")
    sections.append(f"\n**Created:** {today}")
    sections.append("**Purpose:** Persistent context injected into every Claude analysis for this client.")
    sections.append("")
    sections.append("---")
    sections.append("")
    sections.append("## Company Profile")
    sections.append("")
    sections.append(f"- **Company Name:** {company_name}")
    if website:
        sections.append(f"- **Website:** {website}")
    if industry:
        sections.append(f"- **Industry:** {industry}")
    if description:
        sections.append(f"- **Description:** {description}")

    # Multi-contact rendering
    if contacts and len(contacts) > 0:
        sections.append("")
        sections.append("## Contacts")
        for idx, c in enumerate(contacts):
            label = "### Primary Contact" if idx == 0 else f"### Contact {idx + 1}"
            sections.append("")
            sections.append(label)
            sections.append("")
            contact_full_name = f"{c.get('firstName', '')} {c.get('lastName', '')}".strip() or c.get('name', '')
            if contact_full_name:
                sections.append(f"- **Name:** {contact_full_name}")
            if c.get('title'):
                sections.append(f"- **Title:** {c['title']}")
            if c.get('linkedin'):
                sections.append(f"- **LinkedIn:** {c['linkedin']}")
            if c.get('email'):
                sections.append(f"- **Email:** {c['email']}")
            if c.get('phone'):
                sections.append(f"- **Phone:** {c['phone']}")
    elif contact_name or contact_title or contact_linkedin or contact_email or contact_phone:
        # Legacy single-contact fallback
        sections.append("")
        sections.append("## Primary Contact")
        sections.append("")
        if contact_name:
            sections.append(f"- **Name:** {contact_name}")
        if contact_title:
            sections.append(f"- **Title:** {contact_title}")
        if contact_linkedin:
            sections.append(f"- **LinkedIn:** {contact_linkedin}")
        if contact_email:
            sections.append(f"- **Email:** {contact_email}")
        if contact_phone:
            sections.append(f"- **Phone:** {contact_phone}")

    # Multi-address rendering
    if addresses and len(addresses) > 0:
        sections.append("")
        sections.append("## Addresses")
        for idx, a in enumerate(addresses):
            label = a.get('label', '')
            heading = f"### {label}" if label else ("### Primary Address" if idx == 0 else f"### Address {idx + 1}")
            sections.append("")
            sections.append(heading)
            sections.append("")
            if a.get('address1'):
                sections.append(f"- **Address:** {a['address1']}")
            if a.get('address2'):
                sections.append(f"- **Address 2:** {a['address2']}")
            parts = []
            if a.get('city'):
                parts.append(a['city'])
            if a.get('state'):
                parts.append(a['state'])
            if a.get('postalCode'):
                parts.append(a['postalCode'])
            if parts:
                sections.append(f"- **City/State/Zip:** {', '.join(parts)}")
            if a.get('country'):
                sections.append(f"- **Country:** {a['country']}")

    if future_plans:
        sections.append("")
        sections.append("## Future Plans")
        sections.append("")
        sections.append(f"{future_plans}")

    # Pain points: prefer structured array, fall back to legacy single field
    all_pain_points = pain_points if pain_points else ([pain_point] if pain_point else [])
    all_pain_points = [p for p in all_pain_points if p and p.strip()]
    if all_pain_points:
        sections.append("")
        sections.append("## Pain Points")
        sections.append("")
        for i, pp in enumerate(all_pain_points, 1):
            sections.append(f"{i}. {pp}")
        sections.append("")
        sections.append("These are the client's priorities. Every analysis should address these pain points.")

    sections.append("")
    sections.append("---")
    sections.append("")
    sections.append("## Analysis Instructions")
    sections.append("")
    sections.append("- Treat this client as a real business engagement, not a demo")
    sections.append("- Reference their specific data, not generic industry advice")
    sections.append("- Every recommendation must tie back to evidence from their documents")
    sections.append("- Use their company name and industry context throughout the analysis")

    return "\n".join(sections) + "\n"


# ============================================================
# ENGAGEMENTS CRUD
# ============================================================

def _get_client_key_for_engagement(conn, engagement_id):
    """Get the client encryption key for an engagement's parent client."""
    cur = conn.cursor()
    cur.execute("""
        SELECT c.encryption_key FROM engagements e
        JOIN clients c ON c.id = e.client_id
        WHERE e.id = %s
    """, (engagement_id,))
    row = cur.fetchone()
    cur.close()
    if row and row[0]:
        return unwrap_client_key(row[0])
    return None


def _format_engagement(row, client_key=None):
    """Format an engagement DB row into a JSON-serializable dict."""
    contacts = []
    if row[4]:
        try:
            contacts = json.loads(row[4]) if isinstance(row[4], str) else row[4]
            if not contacts:
                contacts = []
        except:
            contacts = []
    contacts = _resolve_contact_photos(contacts)

    return {
        'id': str(row[0]),
        'client_id': str(row[1]),
        'name': row[2] or '',
        'focus_area': row[3] or '',
        'contacts': contacts,
        'status': row[5] or 'active',
        'approved_at': row[6].isoformat() if row[6] else None,
        'approved_by': (row[7] or '') if row[7] else '',
        'created_at': row[8].isoformat() if row[8] else None,
        'updated_at': row[9].isoformat() if row[9] else None,
        'hubspot_deal_id': row[10] or '',
        'poc_scope': row[11] if len(row) > 11 else None,
        'scope_review_needed': bool(row[12]) if len(row) > 12 else False,
    }


def handle_list_engagements(event, user):
    """GET /engagements?client_id=X — List all engagements for a client."""
    try:
        params = event.get('queryStringParameters') or {}
        client_id = params.get('client_id', '')
        engagement_id = params.get('engagement_id', '')

        conn = get_db_connection()
        cur = conn.cursor()

        if engagement_id:
            # Single engagement fetch
            cur.execute("""
                SELECT e.id, e.client_id, e.name, e.focus_area, e.contacts_json,
                       e.status, e.approved_at, e.approved_by,
                       e.created_at, e.updated_at, e.hubspot_deal_id, e.poc_scope, COALESCE(e.scope_review_needed, FALSE)
                FROM engagements e
                JOIN clients c ON c.id = e.client_id
                WHERE e.id = %s
            """, (engagement_id,))
            row = cur.fetchone()
            cur.close()
            conn.close()
            if not row:
                return {'statusCode': 404, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Engagement not found'})}

            # Get client key for decryption
            conn2 = get_db_connection()
            ck = _get_client_key_for_engagement(conn2, engagement_id)
            conn2.close()

            return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({'engagement': _format_engagement(row, ck)})}

        if not client_id:
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'client_id is required'})}

        # Get client encryption key
        cur.execute("SELECT encryption_key FROM clients WHERE s3_folder = %s", (client_id,))
        crow = cur.fetchone()
        ck = unwrap_client_key(crow[0]) if crow and crow[0] else None

        cur.execute("""
            SELECT e.id, e.client_id, e.name, e.focus_area, e.contacts_json,
                   e.status, e.approved_at, e.approved_by,
                   e.created_at, e.updated_at, e.hubspot_deal_id, e.poc_scope, COALESCE(e.scope_review_needed, FALSE)
            FROM engagements e
            JOIN clients c ON c.id = e.client_id
            WHERE c.s3_folder = %s
            ORDER BY e.created_at DESC
        """, (client_id,))
        rows = cur.fetchall()
        cur.close()
        conn.close()

        engagements = [_format_engagement(r, ck) for r in rows]
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({'engagements': engagements})}

    except Exception as e:
        print(f"Error listing engagements: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}


def handle_create_engagement(event, user):
    """POST /engagements — Create a new engagement."""
    try:
        body = json.loads(event.get('body', '{}'))
        client_id = body.get('client_id', '').strip()
        name = body.get('name', '').strip()
        focus_area = body.get('focus_area', '').strip()
        contacts = body.get('contacts', [])
        status = body.get('status', 'active').strip()

        if not client_id or not name:
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'client_id and name are required'})}

        conn = get_db_connection()
        cur = conn.cursor()

        # Get DB client id and encryption key
        cur.execute("SELECT id, encryption_key FROM clients WHERE s3_folder = %s", (client_id,))
        crow = cur.fetchone()
        if not crow:
            cur.close()
            conn.close()
            return {'statusCode': 404, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Client not found'})}

        db_client_id = crow[0]
        ck = unwrap_client_key(crow[1]) if crow[1] else None

        contacts_json_val = json.dumps(contacts) if contacts else None

        cur.execute("""
            INSERT INTO engagements (client_id, name, focus_area, contacts_json, status)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
        """, (db_client_id, name, focus_area, contacts_json_val, status))

        engagement_id = str(cur.fetchone()[0])
        conn.commit()
        cur.close()
        conn.close()

        return {'statusCode': 201, 'headers': CORS_HEADERS, 'body': json.dumps({'engagement_id': engagement_id, 'name': name})}

    except Exception as e:
        print(f"Error creating engagement: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}


def handle_update_engagement(event, user):
    """PUT /engagements — Update an engagement."""
    try:
        body = json.loads(event.get('body', '{}'))
        engagement_id = body.get('engagement_id', '').strip()

        if not engagement_id:
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'engagement_id is required'})}

        conn = get_db_connection()
        ck = _get_client_key_for_engagement(conn, engagement_id)

        set_fields = []
        params = []

        if 'name' in body:
            set_fields.append("name = %s")
            params.append(body['name'].strip())
        if 'focus_area' in body:
            set_fields.append("focus_area = %s")
            params.append(body['focus_area'].strip())
        if 'contacts' in body:
            set_fields.append("contacts_json = %s")
            params.append(json.dumps(body['contacts']) if body['contacts'] else None)
        if 'status' in body:
            set_fields.append("status = %s")
            params.append(body['status'].strip())
        if 'approved' in body:
            if body['approved']:
                set_fields.append("approved_at = NOW()")
                set_fields.append("approved_by = %s")
                params.append(user.get('name', '') or user.get('email', ''))
            else:
                set_fields.append("approved_at = NULL")
                set_fields.append("approved_by = NULL")

        if not set_fields:
            conn.close()
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'No fields to update'})}

        set_fields.append("updated_at = NOW()")
        params.append(engagement_id)

        cur = conn.cursor()
        cur.execute(f"UPDATE engagements SET {', '.join(set_fields)} WHERE id = %s RETURNING id", tuple(params))
        result = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()

        if not result:
            return {'statusCode': 404, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Engagement not found'})}

        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({'updated': True})}

    except Exception as e:
        print(f"Error updating engagement: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}


def handle_delete_engagement(event, user):
    """DELETE /engagements?engagement_id=X — Delete an engagement."""
    try:
        params = event.get('queryStringParameters') or {}
        engagement_id = params.get('engagement_id', '')

        if not engagement_id:
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'engagement_id is required'})}

        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM engagements WHERE id = %s RETURNING id", (engagement_id,))
        result = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()

        if not result:
            return {'statusCode': 404, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Engagement not found'})}

        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({'deleted': True})}

    except Exception as e:
        print(f"Error deleting engagement: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}
