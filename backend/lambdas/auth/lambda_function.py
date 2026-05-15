"""
XO Platform - Auth Lambda
Routes: POST /auth/login, POST /auth/register, POST /auth/reset-password, POST /auth/google,
        PUT /auth/preferences, POST /auth/token, POST/GET/DELETE /auth/magic-link,
        POST /auth/verify-2fa

Three-tier role system: admin, partner, client.
Google OAuth checks: DB role first → client contacts fallback → denied.
Magic links provide token-based client access.
Email-based 2FA on all password and Google logins.
"""

import json
import os
import logging
import random
import secrets
import bcrypt
import jwt
import boto3
import urllib.request
from datetime import datetime, timedelta, timezone
import psycopg2

logger = logging.getLogger('xo')
logger.setLevel(logging.INFO)
try:
    from crypto_helper import encrypt, decrypt, encrypt_json, decrypt_json, search_hash
except ImportError:
    # Fallback if crypto_helper.py not yet deployed — pass-through mode
    def encrypt(x): return x
    def decrypt(x): return x
    def encrypt_json(x): return __import__('json').dumps(x) if x else x
    def decrypt_json(x):
        if not x: return None
        try: return __import__('json').loads(x)
        except: return None
    def search_hash(x): return __import__('hashlib').sha256(x.lower().strip().encode()).hexdigest() if x else ''

DATABASE_URL = os.environ.get('DATABASE_URL', '')
JWT_SECRET = os.environ.get('JWT_SECRET', '')
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'https://d2np82m8rfcd6u.cloudfront.net/')
SES_FROM_EMAIL = os.environ.get('SES_FROM_EMAIL', 'noreply@intellagentic.io')
SES_REGION = os.environ.get('SES_REGION', 'eu-west-2')
TWO_FA_CODE_EXPIRY_MINUTES = 10

ses_client = boto3.client('ses', region_name=SES_REGION)
s3_client = boto3.client('s3', region_name='eu-west-2')
BUCKET_NAME = os.environ.get('BUCKET_NAME', 'xo-client-data-mv')

def _resolve_photo_url(photo_url):
    """Convert stored photo_url to a fresh presigned URL if it's an S3 reference."""
    if not photo_url:
        return ''
    # Extract S3 key from presigned URL or raw S3 URL
    import urllib.parse
    if 'xo-client-data-mv.s3' in photo_url:
        parsed = urllib.parse.urlparse(photo_url)
        s3_key = parsed.path.lstrip('/')
        try:
            return s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': BUCKET_NAME, 'Key': s3_key},
                ExpiresIn=3600
            )
        except Exception:
            return ''
    return photo_url

# Seed these emails as role='admin' on cold start
ADMIN_SEED_EMAILS = [
    'alan.moore@intellagentic.io',
    'ken.scott@intellagentic.io',
    'rs@multiversant.com',
    'vn@multiversant.com'
]

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
}


# ── Auto-migration: client_tokens table ──
def _run_token_migrations():
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS client_tokens (
                id SERIAL PRIMARY KEY,
                token VARCHAR(64) UNIQUE NOT NULL,
                client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT NOW(),
                expires_at TIMESTAMP NOT NULL,
                created_by UUID REFERENCES users(id)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_client_tokens_token ON client_tokens(token)")
        conn.commit()
        cur.close()
        conn.close()
        print("Migration complete: client_tokens table ensured")
    except Exception as e:
        print(f"Token migration check (non-fatal): {e}")

_run_token_migrations()


# ── Auto-migration: rename partners table to accounts (idempotent) ──
def _run_partners_to_accounts_rename():
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        # Check current state
        cur.execute("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'partners')")
        has_partners = cur.fetchone()[0]
        cur.execute("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'accounts')")
        has_accounts = cur.fetchone()[0]

        if has_accounts:
            cur.execute("SELECT count(*) FROM accounts")
            accounts_count = cur.fetchone()[0]
        else:
            accounts_count = 0

        if has_partners:
            cur.execute("SELECT count(*) FROM partners")
            partners_count = cur.fetchone()[0]
        else:
            partners_count = 0

        print(f"Table rename check: partners={has_partners}({partners_count} rows), accounts={has_accounts}({accounts_count} rows)")

        # If accounts already has data, the rename already happened — skip
        if has_accounts and accounts_count > 0:
            print("Accounts table already has data — rename already done, skipping")
            # Still ensure type column exists
            cur.execute("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'partner'")
            conn.commit()
            cur.close()
            conn.close()
            return

        # If partners has data and accounts is empty, do the rename
        if has_partners and partners_count > 0:
            # Drop the empty accounts table if it exists
            if has_accounts and accounts_count == 0:
                print(f"Dropping empty accounts table to make room for rename")
                cur.execute("DROP TABLE IF EXISTS accounts CASCADE")

            # Also need to drop any FKs on clients/users referencing accounts before rename
            # The CASCADE above handles that

            print(f"Renaming partners ({partners_count} rows) -> accounts")
            cur.execute("ALTER TABLE partners RENAME TO accounts")

            # Rename partner_id -> account_id on clients table if old column exists
            cur.execute("""
                DO $$
                BEGIN
                    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='partner_id')
                       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='account_id') THEN
                        ALTER TABLE clients RENAME COLUMN partner_id TO account_id;
                    END IF;
                END $$;
            """)

            # Add type column
            cur.execute("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'partner'")
            cur.execute("UPDATE accounts SET type = 'platform' WHERE name ILIKE '%intellagentic%'")

            conn.commit()

            # Verify
            cur.execute("SELECT count(*) FROM accounts")
            final_count = cur.fetchone()[0]
            cur.execute("SELECT id, name, type FROM accounts ORDER BY id")
            rows = cur.fetchall()
            for r in rows:
                print(f"  Account: id={r[0]}, name={r[1]}, type={r[2]}")
            print(f"Partners->accounts rename complete: {final_count} rows migrated")
        elif not has_partners and not has_accounts:
            print("Neither partners nor accounts table exists — will be created by clients Lambda")
        else:
            print(f"No rename needed: partners={has_partners}({partners_count}), accounts={has_accounts}({accounts_count})")

        cur.close()
        conn.close()
    except Exception as e:
        print(f"Partners->accounts rename (non-fatal): {e}")

_run_partners_to_accounts_rename()


# ── Auto-migration: add role + account_id columns to users, seed admins ──
def _run_role_migrations():
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        # Add role column (default 'client')
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'client'")
        # Rename partner_id -> account_id if old column exists (migration from partners->accounts)
        cur.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='partner_id')
                   AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='account_id') THEN
                    ALTER TABLE users RENAME COLUMN partner_id TO account_id;
                END IF;
            END $$;
        """)
        # Add account_id FK to users (links account users to their account record)
        # Reference accounts if it exists, otherwise partners (migration period)
        cur.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='accounts') THEN
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;
                ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='partners') THEN
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES partners(id) ON DELETE SET NULL;
                ELSE
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS account_id INTEGER;
                END IF;
            END $$;
        """)
        # Add email_hash for encrypted email lookups
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_hash VARCHAR(64)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_users_email_hash ON users(email_hash)")
        # 2FA opt-in flag
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE")
        # Seed admin roles for known admin emails (match by email_hash or legacy plaintext email)
        for email in ADMIN_SEED_EMAILS:
            cur.execute("UPDATE users SET role = 'admin' WHERE email = %s AND (role IS NULL OR role = 'client')", (email,))
        # Set preferred model for admins
        cur.execute("UPDATE users SET preferred_model = 'claude-opus-4-6' WHERE email = 'ken.scott@intellagentic.io' AND (preferred_model IS NULL OR preferred_model != 'claude-opus-4-6')")
        # Fix display names for admin users
        cur.execute("UPDATE users SET name = 'Ken Scott' WHERE email = 'ken.scott@intellagentic.io' AND name != 'Ken Scott'")
        cur.execute("UPDATE users SET name = 'Alan Moore' WHERE email = 'alan.moore@intellagentic.io' AND name != 'Alan Moore'")
        cur.execute("UPDATE users SET name = 'Richie Saville' WHERE email = 'rs@multiversant.com' AND name != 'Richie Saville'")
        cur.execute("UPDATE users SET name = 'Vamsi Nama' WHERE email = 'vn@multiversant.com' AND name != 'Vamsi Nama'")
        cur.execute("UPDATE users SET status = 'deactivated' WHERE email = 'ken.scott@intellagentic.com' AND status != 'deactivated'")
        cur.execute("UPDATE users SET status = 'deactivated' WHERE email = 'xo@intellagentic.io' AND status != 'deactivated'")
        # Assign users to accounts (idempotent)
        cur.execute("INSERT INTO accounts (name) SELECT 'Intellagentic' WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE name = 'Intellagentic')")
        cur.execute("UPDATE users SET account_id = (SELECT id FROM accounts WHERE name = 'Intellagentic') WHERE email IN ('alan.moore@intellagentic.io', 'ken.scott@intellagentic.io', 'rs@multiversant.com', 'vn@multiversant.com') AND account_id IS NULL")
        cur.execute("UPDATE users SET account_id = (SELECT id FROM accounts WHERE name = 'Intellistack') WHERE email = 'kscott@scottaffiliated.com' AND account_id IS NULL")
        cur.execute("UPDATE users SET account_id = (SELECT id FROM accounts WHERE name = 'Intellagentic') WHERE account_id IS NULL")
        conn.commit()
        cur.close()
        conn.close()
        print("Migration complete: users role + account_id + email_hash columns ensured, admins seeded, account assignments set")
    except Exception as e:
        print(f"Role migration check (non-fatal): {e}")

_run_role_migrations()


# ── Multi-tenant auth schema migration ──
def _run_multi_tenant_migrations():
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        # 1. Add multi-tenant columns to users table
        # Reference accounts if it exists, otherwise partners (migration period)
        cur.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='account_id') THEN
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='accounts') THEN
                        ALTER TABLE users ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;
                    ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='partners') THEN
                        ALTER TABLE users ADD COLUMN account_id INTEGER REFERENCES partners(id) ON DELETE SET NULL;
                    ELSE
                        ALTER TABLE users ADD COLUMN account_id INTEGER;
                    END IF;
                END IF;
            END $$;
        """)
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS account_role TEXT CHECK (account_role IN ('super_admin', 'account_admin', 'account_user', 'client_contact'))")
        # Expand account_role enum to include contributor
        cur.execute("""
            DO $$
            BEGIN
                ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_role_check;
                ALTER TABLE users ADD CONSTRAINT users_account_role_check CHECK (account_role IN ('super_admin', 'account_admin', 'account_user', 'client_contact', 'contributor'));
            EXCEPTION WHEN others THEN NULL;
            END $$;
        """)
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' CHECK (status IN ('invited', 'active', 'deactivated'))")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES users(id)")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at TIMESTAMP")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token TEXT")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMP")

        # 2. Data migration: map existing role to account_role (idempotent)
        cur.execute("UPDATE users SET account_role = 'super_admin' WHERE role = 'admin' AND account_role IS NULL")
        cur.execute("UPDATE users SET account_role = 'account_user' WHERE (role = 'partner' OR role = 'user') AND account_role IS NULL")
        cur.execute("UPDATE users SET account_role = 'client_contact' WHERE role = 'client' AND account_role IS NULL")
        cur.execute("UPDATE users SET status = 'active' WHERE status IS NULL")

        # 4. Create user_client_assignments table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_client_assignments (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                assigned_by UUID REFERENCES users(id),
                assigned_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(user_id, client_id)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_uca_user_id ON user_client_assignments(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_uca_client_id ON user_client_assignments(client_id)")

        conn.commit()
        cur.close()
        conn.close()
        print("Multi-tenant migration complete: account_role, status, invite fields, user_client_assignments table")
    except Exception as e:
        print(f"Multi-tenant migration check (non-fatal): {e}")

_run_multi_tenant_migrations()


# ── Auto-migration: two_factor_codes table ──
def _run_2fa_migrations():
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS two_factor_codes (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(64) UNIQUE NOT NULL,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                code VARCHAR(6) NOT NULL,
                email VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                expires_at TIMESTAMP NOT NULL,
                verified BOOLEAN DEFAULT FALSE,
                attempts INTEGER DEFAULT 0
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_2fa_session_id ON two_factor_codes(session_id)")
        conn.commit()
        cur.close()
        conn.close()
        print("Migration complete: two_factor_codes table ensured")
    except Exception as e:
        print(f"2FA migration check (non-fatal): {e}")

_run_2fa_migrations()


def _log_auth_activity(event, response):
    """Log auth activity with user email from request body or JWT."""
    method = event.get('httpMethod', 'UNKNOWN')
    path = event.get('path', 'UNKNOWN')
    status = response.get('statusCode', 0) if isinstance(response, dict) else 0

    email = 'anonymous'
    try:
        body = json.loads(event.get('body', '{}') or '{}')
        email = body.get('email', 'anonymous')
    except Exception:
        pass
    if email == 'anonymous':
        try:
            headers = event.get('headers', {}) or {}
            auth_header = headers.get('Authorization') or headers.get('authorization', '')
            if auth_header.startswith('Bearer '):
                payload = jwt.decode(auth_header[7:], JWT_SECRET, algorithms=['HS256'])
                email = payload.get('email', 'unknown')
        except Exception:
            pass

    result_summary = ''
    try:
        resp_body = response.get('body', '') if isinstance(response, dict) else ''
        if resp_body and isinstance(resp_body, str):
            body_json = json.loads(resp_body)
            if 'error' in body_json:
                result_summary = f"error={body_json['error']}"
            elif 'user' in body_json:
                result_summary = f"role={body_json['user'].get('role', 'unknown')}"
            else:
                keys = list(body_json.keys())[:4]
                result_summary = f"keys={keys}"
    except (json.JSONDecodeError, TypeError):
        result_summary = 'non-json'

    logger.info(
        "API %s %s | user=%s | status=%s | %s",
        method, path, email, status, result_summary
    )


def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    path = event.get('path', '')
    method = event.get('httpMethod', '')

    if path.endswith('/auth/verify-2fa') and method == 'POST':
        response = handle_verify_2fa(event)
    elif path.endswith('/auth/token') and method == 'POST':
        response = handle_validate_token(event)
    elif path.endswith('/auth/magic-link'):
        if method == 'POST':
            response = handle_create_magic_link(event)
        elif method == 'GET':
            response = handle_get_magic_link(event)
        elif method == 'DELETE':
            response = handle_delete_magic_link(event)
        else:
            response = {'statusCode': 405, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Method not allowed'})}
    elif path.endswith('/auth/google'):
        response = handle_google_login(event)
    elif path.endswith('/auth/preferences'):
        response = handle_preferences(event)
    elif path.endswith('/auth/reset-password'):
        response = handle_reset_password(event)
    elif path.endswith('/auth/register'):
        response = handle_register(event)
    elif '/auth/users/' in path:
        response = _route_users(event, path, method)
    elif '/auth/invite' in path:
        response = _route_invite(event, path, method)
    else:
        response = handle_login(event)

    _log_auth_activity(event, response)
    return response


def _make_token(user_id, email, name, role='client', account_id=None, client_id=None, account_role=None):
    """Build JWT with role-based claims."""
    payload = {
        'user_id': str(user_id),
        'email': email,
        'name': name,
        'role': role,
        'is_admin': role == 'admin',
        'is_account': role == 'partner',
        'is_client': role == 'client',
        'exp': datetime.now(timezone.utc) + timedelta(hours=24)
    }
    if account_id:
        payload['account_id'] = account_id
    if client_id:
        payload['client_id'] = client_id
    if account_role:
        payload['account_role'] = account_role
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')


def _success_response(user_id, email, name, preferred_model='claude-sonnet-4-5-20250929',
                      status=200, role='client', account_id=None, client_id=None):
    # Look up account_role and account_id from DB for JWT and response
    account_role = None
    _caller_account_id = account_id
    account_id = None
    tfa_enabled = False
    photo_url = ''
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        cur.execute("SELECT COALESCE(two_factor_enabled, FALSE), account_role, account_id, photo_url FROM users WHERE id = %s", (str(user_id),))
        tfa_row = cur.fetchone()
        if tfa_row:
            tfa_enabled = bool(tfa_row[0])
            account_role = tfa_row[1]
            account_id = tfa_row[2]
            photo_url = tfa_row[3] if len(tfa_row) > 3 else ''
        print(f"[TOKEN] _success_response for {email}: account_role={account_role}, account_id={account_id}")
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[TOKEN] _success_response DB lookup failed for {email}: {e}")
        # Fallback to caller-provided account_id if DB lookup failed
        if not account_id and _caller_account_id:
            account_id = _caller_account_id

    token = _make_token(user_id, email, name, role=role, account_id=account_id, client_id=client_id,
                        account_role=account_role)

    user_data = {
        'id': str(user_id), 'email': email, 'name': name,
        'preferred_model': preferred_model,
        'role': role,
        'is_admin': role == 'admin',
        'is_account': role == 'partner',
        'is_client': role == 'client',
        'two_factor_enabled': tfa_enabled,
        'account_role': account_role,
        'account_id': account_id,
        'photo_url': _resolve_photo_url(photo_url),
    }
    if client_id:
        user_data['client_id'] = client_id
    return {
        'statusCode': status,
        'headers': CORS_HEADERS,
        'body': json.dumps({'token': token, 'user': user_data})
    }


def _send_2fa_email(to_email, code):
    """Send 2FA verification code via AWS SES."""
    try:
        ses_client.send_email(
            Source=SES_FROM_EMAIL,
            Destination={'ToAddresses': [to_email]},
            Message={
                'Subject': {'Data': f'XO Platform - Your verification code: {code}', 'Charset': 'UTF-8'},
                'Body': {
                    'Html': {
                        'Data': f"""
                        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
                            <h2 style="color: #1a1a2e;">XO Platform Verification</h2>
                            <p>Your one-time verification code is:</p>
                            <div style="background: #f0f0f5; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                                <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a1a2e;">{code}</span>
                            </div>
                            <p style="color: #666;">This code expires in {TWO_FA_CODE_EXPIRY_MINUTES} minutes. Do not share it with anyone.</p>
                            <p style="color: #999; font-size: 12px;">If you did not request this code, please ignore this email.</p>
                        </div>
                        """,
                        'Charset': 'UTF-8'
                    },
                    'Text': {
                        'Data': f'Your XO Platform verification code is: {code}\n\nThis code expires in {TWO_FA_CODE_EXPIRY_MINUTES} minutes.',
                        'Charset': 'UTF-8'
                    }
                }
            }
        )
        print(f"2FA code sent to {to_email}")
        return True
    except Exception as e:
        print(f"Failed to send 2FA email to {to_email}: {e}")
        return False


def _start_2fa_challenge(user_id, email, name, preferred_model='claude-sonnet-4-5-20250929',
                         role='client', account_id=None, client_id=None):
    """Generate 2FA code, store it, send email. Returns 2FA challenge response.
    Stores all user context needed to issue the JWT after verification."""
    code = f"{random.randint(0, 999999):06d}"
    session_id = secrets.token_hex(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=TWO_FA_CODE_EXPIRY_MINUTES)

    # Store the code and user context in DB
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        # Clean up expired codes for this user
        cur.execute("DELETE FROM two_factor_codes WHERE user_id = %s OR expires_at < NOW()", (str(user_id),))

        # Store user context as encrypted JSON so we can issue the JWT after verification
        user_context = json.dumps({
            'user_id': str(user_id),
            'email': email,
            'name': name,
            'preferred_model': preferred_model,
            'role': role,
            'account_id': account_id,
            'client_id': client_id
        })

        cur.execute("""
            INSERT INTO two_factor_codes (session_id, user_id, code, email, expires_at)
            VALUES (%s, %s, %s, %s, %s)
        """, (session_id, str(user_id), code, user_context, expires_at))

        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Failed to store 2FA code: {e}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Failed to initiate verification'})
        }

    # Send email
    if not _send_2fa_email(email, code):
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Failed to send verification email'})
        }

    # Mask email for display
    parts = email.split('@')
    if len(parts) == 2 and len(parts[0]) > 2:
        masked = parts[0][0] + '*' * (len(parts[0]) - 2) + parts[0][-1] + '@' + parts[1]
    else:
        masked = email

    return {
        'statusCode': 200,
        'headers': CORS_HEADERS,
        'body': json.dumps({
            'requires_2fa': True,
            'session_id': session_id,
            'masked_email': masked,
            'expires_in': TWO_FA_CODE_EXPIRY_MINUTES * 60
        })
    }


# ============================================================
# POST /auth/verify-2fa — Verify email 2FA code and issue JWT
# ============================================================
def handle_verify_2fa(event):
    """POST /auth/verify-2fa - Verify 2FA code and return JWT."""
    try:
        body = json.loads(event.get('body', '{}'))
        session_id = body.get('session_id', '').strip()
        code = body.get('code', '').strip()

        if not session_id or not code:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'session_id and code are required'})
            }

        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        cur.execute("""
            SELECT id, user_id, code, email, expires_at, verified, attempts
            FROM two_factor_codes
            WHERE session_id = %s
        """, (session_id,))
        row = cur.fetchone()

        if not row:
            cur.close()
            conn.close()
            return {
                'statusCode': 401,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Invalid or expired session'})
            }

        record_id, user_id, stored_code, encrypted_context, expires_at, verified, attempts = row

        # Check if already verified
        if verified:
            cur.close()
            conn.close()
            return {
                'statusCode': 401,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Code already used'})
            }

        # Check expiry
        if datetime.now(timezone.utc) > expires_at.replace(tzinfo=timezone.utc):
            cur.execute("DELETE FROM two_factor_codes WHERE id = %s", (record_id,))
            conn.commit()
            cur.close()
            conn.close()
            return {
                'statusCode': 401,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Code expired. Please log in again.'})
            }

        # Check max attempts (5)
        if attempts >= 5:
            cur.execute("DELETE FROM two_factor_codes WHERE id = %s", (record_id,))
            conn.commit()
            cur.close()
            conn.close()
            return {
                'statusCode': 401,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Too many attempts. Please log in again.'})
            }

        # Verify code
        if code != stored_code:
            cur.execute("UPDATE two_factor_codes SET attempts = attempts + 1 WHERE id = %s", (record_id,))
            conn.commit()
            cur.close()
            conn.close()
            remaining = 4 - attempts
            return {
                'statusCode': 401,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': f'Invalid code. {remaining} attempts remaining.'})
            }

        # Code is valid — mark as verified and delete
        cur.execute("DELETE FROM two_factor_codes WHERE id = %s", (record_id,))
        conn.commit()
        cur.close()
        conn.close()

        # Read user context and issue JWT
        context_str = encrypted_context
        try:
            ctx = json.loads(context_str)
        except (json.JSONDecodeError, TypeError):
            return {
                'statusCode': 500,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Failed to restore session'})
            }

        print(f"2FA verified for user: {ctx['email']}")
        return _success_response(
            ctx['user_id'], ctx['email'], ctx['name'],
            preferred_model=ctx.get('preferred_model', 'claude-sonnet-4-5-20250929'),
            role=ctx.get('role', 'client'),
            account_id=ctx.get('account_id'),
            client_id=ctx.get('client_id')
        )

    except Exception as e:
        print(f"2FA verification error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Internal server error'})
        }


def _upsert_user(conn, cur, email, name, role='client', account_id=None):
    """Upsert a user record. Returns user_id."""
    cur.execute("SELECT id FROM users WHERE email = %s", (email,))
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute(
        "INSERT INTO users (email, password_hash, name, role, account_id) VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (email, 'google-oauth-no-password', name, role, account_id)
    )
    user_id = cur.fetchone()[0]
    conn.commit()
    return user_id


def _verify_admin_or_partner_jwt(event, require_admin=False):
    """Verify JWT from Authorization header. Returns payload or None.
    If require_admin=True, only admins pass. Otherwise admins and partners pass."""
    headers = event.get('headers', {}) or {}
    auth_header = headers.get('Authorization') or headers.get('authorization', '')
    if not auth_header.startswith('Bearer '):
        return None
    token = auth_header[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        role = payload.get('role', payload.get('is_admin') and 'admin' or 'client')
        if require_admin and role != 'admin':
            return None
        if role not in ('admin', 'partner'):
            return None
        payload['role'] = role
        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


# ============================================================
# POST /auth/token — Validate magic link token
# ============================================================
def handle_validate_token(event):
    """POST /auth/token - Validate a magic link token and return JWT."""
    try:
        body = json.loads(event.get('body', '{}'))
        token = body.get('token', '').strip()

        if not token:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Token is required'})
            }

        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        cur.execute("""
            SELECT ct.client_id, c.s3_folder, c.company_name
            FROM client_tokens ct
            JOIN clients c ON ct.client_id = c.id
            WHERE ct.token = %s AND ct.expires_at > NOW()
        """, (token,))
        row = cur.fetchone()

        if not row:
            cur.close()
            conn.close()
            return {
                'statusCode': 401,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Invalid or expired token'})
            }

        db_client_id, s3_folder, company_name = row
        client_email = f"client-token-{s3_folder}@token"
        client_name = company_name or s3_folder

        user_id = _upsert_user(conn, cur, client_email, client_name, role='client')

        cur.close()
        conn.close()

        print(f"Magic link login for client: {s3_folder}")
        return _success_response(
            user_id, client_email, client_name,
            role='client', client_id=s3_folder
        )

    except Exception as e:
        print(f"Token validation error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Internal server error'})
        }


# ============================================================
# POST /auth/magic-link — Generate magic link (admin or partner for own clients)
# ============================================================
def handle_create_magic_link(event):
    """POST /auth/magic-link - Generate a magic link for a client."""
    caller = _verify_admin_or_partner_jwt(event)
    if not caller:
        return {'statusCode': 401, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Admin or partner access required'})}

    try:
        body = json.loads(event.get('body', '{}'))
        client_s3_folder = body.get('client_id', '').strip()

        if not client_s3_folder:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'client_id is required'})
            }

        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        # Look up client — partners can only generate for their own clients
        if caller.get('role') == 'partner':
            cur.execute("SELECT id FROM clients WHERE s3_folder = %s AND account_id = %s",
                        (client_s3_folder, caller.get('account_id')))
        else:
            cur.execute("SELECT id FROM clients WHERE s3_folder = %s", (client_s3_folder,))
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return {
                'statusCode': 404,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Client not found'})
            }
        db_client_id = row[0]

        # Delete existing tokens for this client
        cur.execute("DELETE FROM client_tokens WHERE client_id = %s", (db_client_id,))

        # Generate new token
        new_token = secrets.token_hex(32)
        expires_at = datetime.now(timezone.utc) + timedelta(days=30)

        cur.execute("""
            INSERT INTO client_tokens (token, client_id, expires_at, created_by)
            VALUES (%s, %s, %s, %s)
        """, (new_token, db_client_id, expires_at, caller['user_id']))

        conn.commit()
        cur.close()
        conn.close()

        url = f"{FRONTEND_URL}?token={new_token}"
        print(f"Generated magic link for client: {client_s3_folder}")

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({
                'token': new_token,
                'url': url,
                'expires_at': expires_at.isoformat()
            })
        }

    except Exception as e:
        print(f"Magic link creation error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Internal server error'})
        }


# ============================================================
# GET /auth/magic-link?client_id=X — Get existing link (admin/partner)
# ============================================================
def handle_get_magic_link(event):
    """GET /auth/magic-link - Get existing magic link for a client."""
    caller = _verify_admin_or_partner_jwt(event)
    if not caller:
        return {'statusCode': 401, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Admin or partner access required'})}

    try:
        params = event.get('queryStringParameters') or {}
        client_s3_folder = params.get('client_id', '').strip()

        if not client_s3_folder:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'client_id is required'})
            }

        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        if caller.get('role') == 'partner':
            cur.execute("SELECT id FROM clients WHERE s3_folder = %s AND account_id = %s",
                        (client_s3_folder, caller.get('account_id')))
        else:
            cur.execute("SELECT id FROM clients WHERE s3_folder = %s", (client_s3_folder,))
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return {
                'statusCode': 404,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Client not found'})
            }
        db_client_id = row[0]

        cur.execute("""
            SELECT token, expires_at FROM client_tokens
            WHERE client_id = %s AND expires_at > NOW()
            ORDER BY created_at DESC LIMIT 1
        """, (db_client_id,))
        row = cur.fetchone()
        cur.close()
        conn.close()

        if row:
            return {
                'statusCode': 200,
                'headers': CORS_HEADERS,
                'body': json.dumps({
                    'token': row[0],
                    'url': f"{FRONTEND_URL}?token={row[0]}",
                    'expires_at': row[1].isoformat() if row[1] else None
                })
            }
        else:
            return {
                'statusCode': 200,
                'headers': CORS_HEADERS,
                'body': json.dumps({'token': None, 'url': None, 'expires_at': None})
            }

    except Exception as e:
        print(f"Get magic link error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Internal server error'})
        }


# ============================================================
# DELETE /auth/magic-link?client_id=X — Revoke link (admin/partner)
# ============================================================
def handle_delete_magic_link(event):
    """DELETE /auth/magic-link - Revoke all magic links for a client."""
    caller = _verify_admin_or_partner_jwt(event)
    if not caller:
        return {'statusCode': 401, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Admin or partner access required'})}

    try:
        params = event.get('queryStringParameters') or {}
        client_s3_folder = params.get('client_id', '').strip()

        if not client_s3_folder:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'client_id is required'})
            }

        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        if caller.get('role') == 'partner':
            cur.execute("SELECT id FROM clients WHERE s3_folder = %s AND account_id = %s",
                        (client_s3_folder, caller.get('account_id')))
        else:
            cur.execute("SELECT id FROM clients WHERE s3_folder = %s", (client_s3_folder,))
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return {
                'statusCode': 404,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Client not found'})
            }
        db_client_id = row[0]

        cur.execute("DELETE FROM client_tokens WHERE client_id = %s", (db_client_id,))
        conn.commit()
        cur.close()
        conn.close()

        print(f"Revoked magic links for client: {client_s3_folder}")
        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'revoked': True})
        }

    except Exception as e:
        print(f"Delete magic link error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Internal server error'})
        }


# ============================================================
# POST /auth/google — Google OAuth login (three-tier role check)
# ============================================================
def handle_google_login(event):
    """POST /auth/google - Verify Google ID token and login/create user.
    Priority: DB role (admin/partner) → client contacts → denied."""
    try:
        body = json.loads(event.get('body', '{}'))
        credential = body.get('credential', '')

        if not credential:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Google credential is required'})
            }

        # Verify token via Google's tokeninfo endpoint
        try:
            url = f'https://oauth2.googleapis.com/tokeninfo?id_token={credential}'
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=10) as resp:
                token_info = json.loads(resp.read().decode('utf-8'))
        except Exception as e:
            print(f"Google token verification failed: {e}")
            return {
                'statusCode': 401,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Invalid Google token'})
            }

        # Validate audience matches our client ID
        if token_info.get('aud') != GOOGLE_CLIENT_ID:
            return {
                'statusCode': 401,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Token audience mismatch'})
            }

        # Validate email is verified
        if token_info.get('email_verified') != 'true':
            return {
                'statusCode': 401,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Email not verified'})
            }

        email = token_info.get('email', '').lower()
        name = token_info.get('name', '') or email.split('@')[0].replace('.', ' ').title()

        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        # Step 1: Check if user exists in DB with a role
        cur.execute(
            "SELECT id, email, name, COALESCE(preferred_model, 'claude-sonnet-4-5-20250929'), COALESCE(role, 'client'), account_id, COALESCE(two_factor_enabled, FALSE) FROM users WHERE email = %s",
            (email,)
        )
        user_row = cur.fetchone()

        if user_row:
            user_id, user_email, user_name, preferred_model, role, account_id, tfa_enabled = (
                user_row[0], user_row[1], user_row[2],
                user_row[3], user_row[4], user_row[5], bool(user_row[6])
            )

            if role == 'admin':
                cur.close()
                conn.close()
                if tfa_enabled:
                    print(f"Google login valid (admin): {user_email} — starting 2FA")
                    return _start_2fa_challenge(user_id, user_email, user_name, preferred_model, role='admin')
                print(f"Google login successful (admin): {user_email}")
                return _success_response(user_id, user_email, user_name, preferred_model, role='admin')

            if role == 'partner':
                cur.close()
                conn.close()
                if tfa_enabled:
                    print(f"Google login valid (partner): {user_email}, account_id={account_id} — starting 2FA")
                    return _start_2fa_challenge(user_id, user_email, user_name, preferred_model, role='partner', account_id=account_id)
                print(f"Google login successful (partner): {user_email}, account_id={account_id}")
                return _success_response(user_id, user_email, user_name, preferred_model, role='partner', account_id=account_id)

            # Check account_role for invited users (account_user, account_admin, contributor, client_contact)
            cur.execute("SELECT account_role FROM users WHERE id = %s", (user_id,))
            ar_row = cur.fetchone()
            ar = ar_row[0] if ar_row else None
            if ar in ('account_user', 'account_admin', 'contributor', 'client_contact'):
                cur.close()
                conn.close()
                if tfa_enabled:
                    print(f"Google login valid ({ar}): {user_email}, account_id={account_id} — starting 2FA")
                    return _start_2fa_challenge(user_id, user_email, user_name, preferred_model, role=role, account_id=account_id)
                print(f"Google login successful ({ar}): {user_email}, account_id={account_id}")
                return _success_response(user_id, user_email, user_name, preferred_model, role=role, account_id=account_id)

            # role='client' with no account_role — fall through to client contacts check

        # Step 2: Check if email is in ADMIN_SEED_EMAILS (in case user not yet in DB)
        if email.lower() in [e.lower() for e in ADMIN_SEED_EMAILS]:
            user_id = _upsert_user(conn, cur, email, name, role='admin')
            # Also ensure role is set correctly for existing users
            cur.execute("UPDATE users SET role = 'admin' WHERE id = %s", (user_id,))
            # Check 2FA for this user
            cur.execute("SELECT COALESCE(two_factor_enabled, FALSE) FROM users WHERE id = %s", (user_id,))
            tfa_row = cur.fetchone()
            tfa_enabled = bool(tfa_row[0]) if tfa_row else False
            conn.commit()
            cur.close()
            conn.close()
            if tfa_enabled:
                print(f"Google login valid (admin seed): {email} — starting 2FA")
                return _start_2fa_challenge(user_id, email, name, role='admin')
            print(f"Google login successful (admin seed): {email}")
            return _success_response(user_id, email, name, role='admin')

        # Step 3: Check if email matches any client contact
        cur.execute("SELECT id, s3_folder, contacts_json, company_name FROM clients WHERE contacts_json IS NOT NULL")
        rows = cur.fetchall()

        for row in rows:
            db_client_id, s3_folder, contacts_raw, company_name = row
            try:
                contacts = json.loads(contacts_raw) if isinstance(contacts_raw, str) else contacts_raw
                if not contacts:
                    continue
            except (json.JSONDecodeError, TypeError):
                continue
            for contact in contacts:
                contact_email = (contact.get('email') or '').lower().strip()
                if contact_email and contact_email == email:
                    user_id = _upsert_user(conn, cur, email, name, role='client')
                    # Check 2FA for this user
                    cur.execute("SELECT COALESCE(two_factor_enabled, FALSE) FROM users WHERE id = %s", (user_id,))
                    tfa_row = cur.fetchone()
                    tfa_enabled = bool(tfa_row[0]) if tfa_row else False
                    cur.close()
                    conn.close()
                    if tfa_enabled:
                        print(f"Google login valid (client contact): {email} -> {s3_folder} — starting 2FA")
                        return _start_2fa_challenge(
                            user_id, email, name,
                            role='client', client_id=s3_folder
                        )
                    print(f"Google login successful (client contact): {email} -> {s3_folder}")
                    return _success_response(
                        user_id, email, name,
                        role='client', client_id=s3_folder
                    )

        cur.close()
        conn.close()

        # No match — access denied
        return {
            'statusCode': 403,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Access denied. This email is not authorized.'})
        }

    except Exception as e:
        print(f"Google login error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Internal server error'})
        }


def handle_login(event):
    """POST /auth/login - If user exists, verify password. If not, create account."""
    try:
        body = json.loads(event.get('body', '{}'))
        email = body.get('email', '').strip().lower()
        password = body.get('password', '')

        if not email or not password:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Email and password are required'})
            }

        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        cur.execute(
            "SELECT id, email, password_hash, name, COALESCE(preferred_model, 'claude-sonnet-4-5-20250929'), COALESCE(role, 'client'), account_id, COALESCE(two_factor_enabled, FALSE) FROM users WHERE email = %s",
            (email,)
        )
        row = cur.fetchone()

        if row:
            cur.close()
            conn.close()
            user_id = row[0]
            user_email = row[1]
            password_hash = row[2]
            user_name = row[3]
            preferred_model = row[4]
            role = row[5]
            account_id = row[6]
            tfa_enabled = bool(row[7])

            if not bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8')):
                return {
                    'statusCode': 401,
                    'headers': CORS_HEADERS,
                    'body': json.dumps({'error': 'Invalid password'})
                }

            if tfa_enabled:
                print(f"Login credentials valid: {user_email} (role={role}) — starting 2FA")
                return _start_2fa_challenge(
                    user_id, user_email, user_name, preferred_model,
                    role=role, account_id=account_id
                )

            print(f"Login successful: {user_email} (role={role})")
            return _success_response(user_id, user_email, user_name, preferred_model, role=role, account_id=account_id)

        else:
            if len(password) < 8:
                cur.close()
                conn.close()
                return {
                    'statusCode': 400,
                    'headers': CORS_HEADERS,
                    'body': json.dumps({'error': 'Password must be at least 8 characters'})
                }

            name = email.split('@')[0].replace('.', ' ').title()
            password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

            cur.execute(
                "INSERT INTO users (email, password_hash, name, role) VALUES (%s, %s, %s, 'client') RETURNING id",
                (email, password_hash, name)
            )
            user_id = cur.fetchone()[0]
            conn.commit()
            cur.close()
            conn.close()

            print(f"New account created: {email}")
            return _success_response(user_id, email, name, status=201)

    except Exception as e:
        print(f"Login error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Internal server error'})
        }


def handle_register(event):
    """POST /auth/register - Explicit registration (kept for API compatibility)."""
    try:
        body = json.loads(event.get('body', '{}'))
        email = body.get('email', '').strip().lower()
        password = body.get('password', '')
        name = body.get('name', '').strip()

        if not email or not password:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Email and password are required'})
            }

        if len(password) < 8:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Password must be at least 8 characters'})
            }

        if not name:
            name = email.split('@')[0].replace('.', ' ').title()

        password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        cur.execute("SELECT id FROM users WHERE email = %s", (email,))
        if cur.fetchone():
            cur.close()
            conn.close()
            return {
                'statusCode': 409,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'An account with that email already exists'})
            }

        cur.execute(
            "INSERT INTO users (email, password_hash, name, role) VALUES (%s, %s, %s, 'client') RETURNING id",
            (email, password_hash, name)
        )
        user_id = cur.fetchone()[0]
        conn.commit()
        cur.close()
        conn.close()

        print(f"Registration successful: {email}")
        return _success_response(user_id, email, name, status=201)

    except Exception as e:
        print(f"Register error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Internal server error'})
        }


def handle_reset_password(event):
    """POST /auth/reset-password - Directly resets password (prototype, no email verification)."""
    try:
        body = json.loads(event.get('body', '{}'))
        email = body.get('email', '').strip().lower()
        new_password = body.get('new_password', '')

        if not email or not new_password:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Email and new password are required'})
            }

        if len(new_password) < 8:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Password must be at least 8 characters'})
            }

        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        cur.execute("SELECT id FROM users WHERE email = %s", (email,))
        user_row = cur.fetchone()
        if not user_row:
            cur.close()
            conn.close()
            return {
                'statusCode': 404,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'No account found with that email'})
            }

        password_hash = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        cur.execute("UPDATE users SET password_hash = %s WHERE id = %s", (password_hash, user_row[0]))
        conn.commit()
        cur.close()
        conn.close()

        print(f"Password reset for: {email}")
        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'message': 'Password reset successfully'})
        }

    except Exception as e:
        print(f"Reset password error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Internal server error'})
        }


def handle_preferences(event):
    """PUT /auth/preferences - Update user preferences (requires auth)."""
    headers = event.get('headers', {}) or {}
    auth_header = headers.get('Authorization') or headers.get('authorization', '')
    if not auth_header.startswith('Bearer '):
        return {'statusCode': 401, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Unauthorized'})}

    token = auth_header[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        user_id = payload['user_id']
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return {'statusCode': 401, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Unauthorized'})}

    try:
        body = json.loads(event.get('body', '{}'))
        response_data = {}

        # Allow admins to update another user's preferences via target_user_id
        target_user_id = body.get('user_id')
        if target_user_id and target_user_id != user_id:
            caller_role = payload.get('account_role')
            if caller_role not in ('super_admin', 'account_admin'):
                return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Admin required to update other users'})}
            user_id = target_user_id

        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        # Update preferred_model if provided
        if 'preferred_model' in body:
            preferred_model = body['preferred_model']
            allowed_models = ['claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001']
            if preferred_model not in allowed_models:
                cur.close()
                conn.close()
                return {
                    'statusCode': 400,
                    'headers': CORS_HEADERS,
                    'body': json.dumps({'error': f'Invalid model. Allowed: {", ".join(allowed_models)}'})
                }
            cur.execute("UPDATE users SET preferred_model = %s WHERE id = %s", (preferred_model, user_id))
            response_data['preferred_model'] = preferred_model

        # Update two_factor_enabled if provided
        if 'two_factor_enabled' in body:
            tfa_val = bool(body['two_factor_enabled'])
            cur.execute("UPDATE users SET two_factor_enabled = %s WHERE id = %s", (tfa_val, user_id))
            response_data['two_factor_enabled'] = tfa_val
            print(f"2FA {'enabled' if tfa_val else 'disabled'} for user {user_id}")

        # Update photo_url if provided
        if 'photo_url' in body:
            photo_val = body['photo_url'].strip() if body['photo_url'] else ''
            cur.execute("UPDATE users SET photo_url = %s WHERE id = %s", (photo_val, user_id))
            response_data['photo_url'] = photo_val

        conn.commit()

        # Return current 2FA status
        cur.execute("SELECT COALESCE(two_factor_enabled, FALSE) FROM users WHERE id = %s", (user_id,))
        tfa_row = cur.fetchone()
        response_data['two_factor_enabled'] = bool(tfa_row[0]) if tfa_row else False

        cur.close()
        conn.close()

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps(response_data)
        }

    except Exception as e:
        print(f"Preferences error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Internal server error'})
        }


# ============================================================
# INVITE FLOW — Phase 2 Multi-Tenant Auth
# ============================================================

SES_REGION = os.environ.get('SES_REGION', 'eu-west-2')
SES_FROM_EMAIL = os.environ.get('SES_FROM_EMAIL', 'xo@intellagentic.io')
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'https://xo.intellagentic.io')

ses_client = boto3.client('ses', region_name=SES_REGION)


def _route_invite(event, path, method):
    """Route invite-related requests."""
    # Authenticated endpoints (check specific paths FIRST before wildcard token match)
    if path.endswith('/auth/invite/role') and method == 'PATCH':
        return handle_role_change(event)
    if path.endswith('/auth/invite/resend') and method == 'POST':
        return handle_invite_resend(event)
    if path.endswith('/auth/invite') and method == 'POST':
        return handle_invite_send(event)
    if path.endswith('/auth/invite') and method == 'GET':
        return handle_invite_list(event)
    if path.endswith('/auth/invite') and method == 'DELETE':
        return handle_user_deactivate(event)

    # Public endpoints (no auth): GET/POST /auth/invite/{token} and /auth/invite/{token}/accept
    if '/auth/invite/' in path:
        token = path.split('/auth/invite/')[-1]
        if '/' in token:
            # /auth/invite/{token}/accept
            token = token.split('/')[0]
            if method == 'POST':
                return handle_invite_accept(event, token)
        else:
            if method == 'GET':
                return handle_invite_validate(event, token)
        return {'statusCode': 405, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Method not allowed'})}

    return {'statusCode': 404, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Not found'})}


def _verify_invite_caller(event):
    """Verify JWT and check caller is super_admin or account_admin. Returns (user_payload, error_response)."""
    headers = event.get('headers', {}) or {}
    auth_header = headers.get('Authorization') or headers.get('authorization', '')
    if not auth_header.startswith('Bearer '):
        return None, {'statusCode': 401, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Unauthorized'})}
    try:
        payload = jwt.decode(auth_header[7:], JWT_SECRET, algorithms=['HS256'])
        account_role = payload.get('account_role')
        if account_role not in ('super_admin', 'account_admin'):
            return None, {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Only super_admin and account_admin can manage invites'})}
        return payload, None
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None, {'statusCode': 401, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Invalid or expired token'})}


def _send_invite_email(to_email, to_name, inviter_name, account_name, invite_token):
    """Send invite email via SES."""
    invite_url = f"{FRONTEND_URL}/accept-invite?token={invite_token}"

    # Build invite line — avoid "join XO Capture on XO Capture"
    if account_name and account_name != 'XO Capture':
        invite_line_html = f'<strong>{inviter_name}</strong> has invited you to join <strong>{account_name}</strong> on XO Capture.'
        invite_line_text = f'{inviter_name} has invited you to join {account_name} on XO Capture.'
    else:
        invite_line_html = f'<strong>{inviter_name}</strong> has invited you to join XO Capture.'
        invite_line_text = f'{inviter_name} has invited you to join XO Capture.'

    html_body = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:24px 32px;">
  <span style="color:#ffffff;font-size:18px;font-weight:700;">Intellagentic</span><span style="color:#CC0000;font-size:18px;font-weight:700;">XO</span>
</td></tr>
<tr><td style="padding:32px;">
  <p style="margin:0 0 16px;font-size:16px;color:#333;">Hi {to_name},</p>
  <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
    {invite_line_html}
  </p>
  <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
  <tr><td style="background:#CC0000;border-radius:8px;padding:12px 32px;">
    <a href="{invite_url}" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;display:block;">Accept Invitation</a>
  </td></tr>
  </table>
  <p style="margin:0 0 8px;font-size:13px;color:#999;">This invitation expires in 30 days.</p>
  <p style="margin:0;font-size:13px;color:#999;">If you didn't expect this, you can safely ignore this email.</p>
</td></tr>
<tr><td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
  <p style="margin:0;font-size:12px;color:#9ca3af;">XO Capture by Intellagentic</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>"""

    text_body = f"""Hi {to_name},

{invite_line_text}

Accept your invitation: {invite_url}

This invitation expires in 30 days.

XO Capture by Intellagentic"""

    try:
        ses_client.send_email(
            Source=f"XO Capture <{SES_FROM_EMAIL}>",
            Destination={'ToAddresses': [to_email]},
            Message={
                'Subject': {'Data': "You've been invited to XO Capture", 'Charset': 'UTF-8'},
                'Body': {
                    'Html': {'Data': html_body, 'Charset': 'UTF-8'},
                    'Text': {'Data': text_body, 'Charset': 'UTF-8'},
                }
            }
        )
        print(f"Invite email sent to {to_email}")
        return True
    except Exception as e:
        print(f"Failed to send invite email to {to_email}: {e}")
        return False


def handle_invite_send(event):
    """POST /auth/invite — Send an invitation."""
    caller, err = _verify_invite_caller(event)
    if err:
        return err

    try:
        body = json.loads(event.get('body', '{}'))
        email = body.get('email', '').strip().lower()
        name = body.get('name', '').strip()
        account_id = body.get('account_id')
        account_role = body.get('account_role', 'account_user')

        if not email or not name:
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'email and name are required'})}

        if account_role not in ('account_admin', 'account_user', 'client_contact', 'contributor'):
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Invalid account_role'})}

        caller_role = caller.get('account_role')
        caller_account_id = caller.get('account_id')

        # Permission checks
        if caller_role == 'account_admin':
            if not account_id:
                account_id = caller_account_id
            if str(account_id) != str(caller_account_id):
                return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Account admins can only invite to their own account'})}
            if account_role == 'super_admin':
                return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Account admins cannot grant super_admin role'})}

        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        # Check if user already exists
        cur.execute("SELECT id, status FROM users WHERE email = %s", (email,))
        existing = cur.fetchone()

        if existing and existing[1] == 'active':
            cur.close()
            conn.close()
            return {'statusCode': 409, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'User already exists and is active'})}

        # Generate invite token
        invite_token = secrets.token_urlsafe(48)
        expires_at = datetime.now(timezone.utc) + timedelta(days=30)

        if existing and existing[1] in ('invited', 'deactivated'):
            # Reactivate or resend — update existing row
            user_id = existing[0]
            cur.execute("""
                UPDATE users SET name = %s, invite_token = %s, invite_expires_at = %s,
                    invited_by = %s, invited_at = NOW(), account_id = %s, account_role = %s,
                    status = 'invited'
                WHERE id = %s
            """, (name, invite_token, expires_at, caller['user_id'], account_id, account_role, user_id))
        else:
            # New invite
            try:
                cur.execute("""
                    INSERT INTO users (email, password_hash, name, role, account_id, account_role, status,
                        invite_token, invite_expires_at, invited_by, invited_at)
                    VALUES (%s, 'invite-pending', %s, 'client', %s, %s, 'invited', %s, %s, %s, NOW())
                    RETURNING id
                """, (email, name, account_id, account_role, invite_token, expires_at, caller['user_id']))
                user_id = cur.fetchone()[0]
            except psycopg2.errors.UniqueViolation:
                conn.rollback()
                cur.close()
                conn.close()
                return {'statusCode': 409, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'User with this email already exists'})}

        conn.commit()

        # Get account name for email
        account_name = 'XO Capture'
        if account_id:
            cur.execute("SELECT name FROM accounts WHERE id = %s", (account_id,))
            arow = cur.fetchone()
            if arow:
                account_name = arow[0] or 'XO Capture'

        # Query inviter's actual name from DB (don't rely on JWT which may be stale)
        cur.execute("SELECT name FROM users WHERE id = %s", (caller['user_id'],))
        inviter_row = cur.fetchone()
        inviter_name = (inviter_row[0] if inviter_row and inviter_row[0] else None) or caller.get('name') or caller.get('email', 'An administrator')

        cur.close()
        conn.close()

        # Send email
        email_sent = _send_invite_email(email, name, inviter_name, account_name, invite_token)

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'success': True, 'user_id': str(user_id), 'email_sent': email_sent})
        }

    except Exception as e:
        print(f"Invite send error: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}


def handle_invite_resend(event):
    """POST /auth/invite/resend — Resend an invitation."""
    caller, err = _verify_invite_caller(event)
    if err:
        return err

    try:
        body = json.loads(event.get('body', '{}'))
        user_id = body.get('user_id', '').strip()

        if not user_id:
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'user_id is required'})}

        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        cur.execute("SELECT email, name, status, account_id FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return {'statusCode': 404, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'User not found'})}

        if row[2] != 'invited':
            cur.close()
            conn.close()
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'User is not in invited status'})}

        # Permission check for account_admin
        caller_role = caller.get('account_role')
        if caller_role == 'account_admin' and str(row[3]) != str(caller.get('account_id')):
            cur.close()
            conn.close()
            return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Cannot resend invites for users in other accounts'})}

        invite_token = secrets.token_urlsafe(48)
        expires_at = datetime.now(timezone.utc) + timedelta(days=30)

        cur.execute("""
            UPDATE users SET invite_token = %s, invite_expires_at = %s, invited_at = NOW()
            WHERE id = %s
        """, (invite_token, expires_at, user_id))
        conn.commit()

        # Get account name
        account_name = 'XO Capture'
        if row[3]:
            cur.execute("SELECT name FROM accounts WHERE id = %s", (row[3],))
            arow = cur.fetchone()
            if arow:
                account_name = arow[0] or 'XO Capture'

        # Query inviter's actual name from DB
        cur.execute("SELECT name FROM users WHERE id = %s", (caller['user_id'],))
        inviter_row = cur.fetchone()
        inviter_name = (inviter_row[0] if inviter_row and inviter_row[0] else None) or caller.get('name') or caller.get('email', 'An administrator')

        cur.close()
        conn.close()

        email_sent = _send_invite_email(row[0], row[1], inviter_name, account_name, invite_token)

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'success': True, 'email_sent': email_sent})
        }

    except Exception as e:
        print(f"Invite resend error: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}


def handle_invite_validate(event, token):
    """GET /auth/invite/{token} — Validate an invite token (public, no auth)."""
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        cur.execute("""
            SELECT u.email, u.name, u.invite_expires_at, a.name as account_name
            FROM users u
            LEFT JOIN accounts a ON u.account_id = a.id
            WHERE u.invite_token = %s AND u.status = 'invited'
        """, (token,))
        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({'valid': False, 'reason': 'invalid'})}

        if row[2] and row[2].replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
            return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({'valid': False, 'reason': 'expired'})}

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({
                'valid': True,
                'email': row[0],
                'name': row[1],
                'account_name': row[3] or 'XO Capture',
            })
        }

    except Exception as e:
        print(f"Invite validate error: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}


def handle_invite_accept(event, token):
    """POST /auth/invite/{token}/accept — Accept invitation and set password (public, no auth)."""
    try:
        body = json.loads(event.get('body', '{}'))
        password = body.get('password', '')

        if len(password) < 8:
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Password must be at least 8 characters'})}

        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        cur.execute("""
            SELECT id, email, name, invite_expires_at, role, account_id, account_role
            FROM users
            WHERE invite_token = %s AND status = 'invited'
        """, (token,))
        row = cur.fetchone()

        if not row:
            cur.close()
            conn.close()
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Invalid invitation token'})}

        if row[3] and row[3].replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
            cur.close()
            conn.close()
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Invitation has expired. Please ask your administrator to resend.'})}

        user_id, email, name, _, role, account_id, account_role = row

        # Hash password and activate user
        password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        cur.execute("""
            UPDATE users SET
                password_hash = %s, status = 'active',
                invite_token = NULL, invite_expires_at = NULL
            WHERE id = %s
        """, (password_hash, user_id))
        conn.commit()
        cur.close()
        conn.close()

        print(f"Invite accepted: {email} (account_role={account_role})")

        # Return JWT to log them in immediately
        return _success_response(user_id, email, name, role=role, account_id=account_id)

    except Exception as e:
        print(f"Invite accept error: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}


def handle_invite_list(event):
    """GET /auth/invite — List invited users for an account."""
    caller, err = _verify_invite_caller(event)
    if err:
        return err

    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        caller_role = caller.get('account_role')
        caller_account_id = caller.get('account_id')

        if caller_role == 'super_admin':
            cur.execute("""
                SELECT u.id, u.email, u.name, u.account_role, u.status, u.invited_at, u.account_id, a.name as account_name, u.photo_url
                FROM users u
                LEFT JOIN accounts a ON u.account_id = a.id
                WHERE u.email NOT LIKE 'client-token-%%'
                ORDER BY u.created_at DESC
            """)
        else:
            cur.execute("""
                SELECT u.id, u.email, u.name, u.account_role, u.status, u.invited_at, u.account_id, a.name as account_name, u.photo_url
                FROM users u
                LEFT JOIN accounts a ON u.account_id = a.id
                WHERE u.account_id = %s AND u.email NOT LIKE 'client-token-%%'
                ORDER BY u.created_at DESC
            """, (caller_account_id,))

        rows = cur.fetchall()

        # Temporary diagnostic: dump accounts and user summary
        cur2 = conn.cursor()
        cur2.execute("SELECT id, name FROM accounts ORDER BY id")
        accts = cur2.fetchall()
        for a in accts:
            print(f"[DIAG] Account: id={a[0]}, name={a[1]}")
        cur2.execute("SELECT id, name, email, account_role, account_id FROM users WHERE email NOT LIKE 'client-token-%%' ORDER BY account_id NULLS LAST, name")
        urows = cur2.fetchall()
        for u in urows:
            print(f"[DIAG] User: id={u[0]}, name={u[1]}, email={u[2]}, role={u[3]}, account_id={u[4]}")
        cur2.close()

        cur.close()
        conn.close()

        users = [{
            'id': str(r[0]), 'email': r[1], 'name': r[2],
            'account_role': r[3], 'status': r[4],
            'invited_at': r[5].isoformat() if r[5] else None,
            'account_id': r[6], 'account_name': r[7] or '',
            'photo_url': _resolve_photo_url(r[8]),
        } for r in rows]

        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({'users': users})}

    except Exception as e:
        print(f"Invite list error: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}


def handle_user_deactivate(event):
    """DELETE /auth/invite — Deactivate (soft delete) a user."""
    caller, err = _verify_invite_caller(event)
    if err:
        return err

    try:
        params = event.get('queryStringParameters') or {}
        user_id = params.get('user_id', '').strip()

        if not user_id:
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'user_id query param is required'})}

        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        cur.execute("SELECT email, name, account_id, account_role FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return {'statusCode': 404, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'User not found'})}

        # Permission check: account_admin can only deactivate users in their own account
        caller_role = caller.get('account_role')
        if caller_role == 'account_admin' and str(row[2]) != str(caller.get('account_id')):
            cur.close()
            conn.close()
            return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Cannot remove users from other accounts'})}

        # Prevent deactivating super_admins unless caller is also super_admin
        if row[3] == 'super_admin' and caller_role != 'super_admin':
            cur.close()
            conn.close()
            return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Cannot deactivate super admins'})}

        # Prevent self-deactivation
        if str(user_id) == str(caller.get('user_id')):
            cur.close()
            conn.close()
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Cannot deactivate yourself'})}

        # Last-admin protection
        if row[3] in ('account_admin', 'super_admin'):
            cur.execute("SELECT count(*) FROM users WHERE account_id = %s AND account_role IN ('account_admin', 'super_admin') AND status = 'active' AND id != %s", (row[2], user_id))
            admin_count = cur.fetchone()[0]
            if admin_count == 0:
                cur.close(); conn.close()
                return {'statusCode': 409, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Cannot remove the last admin on this account'})}

        cur.execute("UPDATE users SET status = 'deactivated' WHERE id = %s", (user_id,))
        conn.commit()
        cur.close()
        conn.close()

        print(f"User deactivated: {row[0]} by {caller.get('email')}")
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({'success': True, 'deactivated': True})}

    except Exception as e:
        print(f"User deactivate error: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}


def _route_users(event, path, method):
    """Route user management requests."""
    # /auth/users/{userId}/clients
    if '/clients' in path:
        parts = path.split('/auth/users/')[-1].split('/')
        user_id = parts[0] if parts else ''
        if method == 'GET':
            return handle_get_user_clients(event, user_id)
        elif method == 'POST':
            return handle_set_user_clients(event, user_id)
    return {'statusCode': 404, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Not found'})}


def handle_get_user_clients(event, target_user_id):
    """GET /auth/users/{userId}/clients — Get client assignments for a user."""
    caller, err = _verify_invite_caller(event)
    if err:
        return err

    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        # Verify target user exists and caller has access
        cur.execute("SELECT account_id FROM users WHERE id = %s", (target_user_id,))
        target = cur.fetchone()
        if not target:
            cur.close(); conn.close()
            return {'statusCode': 404, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'User not found'})}

        # account_admin can only see assignments for users in their account
        if caller.get('account_role') == 'account_admin' and str(target[0]) != str(caller.get('account_id')):
            cur.close(); conn.close()
            return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Cannot view assignments for users in other accounts'})}

        cur.execute("""
            SELECT uca.client_id, c.company_name, c.s3_folder
            FROM user_client_assignments uca
            JOIN clients c ON uca.client_id = c.id
            WHERE uca.user_id = %s
        """, (target_user_id,))
        rows = cur.fetchall()
        cur.close(); conn.close()

        assignments = [{'client_id': str(r[0]), 'company_name': r[1] or '', 's3_folder': r[2] or ''} for r in rows]
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({'assignments': assignments})}

    except Exception as e:
        print(f"Get user clients error: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}


def handle_set_user_clients(event, target_user_id):
    """POST /auth/users/{userId}/clients — Set client assignments (replace all)."""
    caller, err = _verify_invite_caller(event)
    if err:
        return err

    try:
        body = json.loads(event.get('body', '{}'))
        client_ids = body.get('client_ids', [])

        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        # Verify target user exists and caller has access
        cur.execute("SELECT account_id FROM users WHERE id = %s", (target_user_id,))
        target = cur.fetchone()
        if not target:
            cur.close(); conn.close()
            return {'statusCode': 404, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'User not found'})}

        if caller.get('account_role') == 'account_admin' and str(target[0]) != str(caller.get('account_id')):
            cur.close(); conn.close()
            return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Cannot assign clients for users in other accounts'})}

        # PR 3.4: validate every client_id before insert. Allowed if:
        #   (a) client.account_id == target user's account_id (same-tenant
        #       assignment — the existing behaviour), OR
        #   (b) a share grant exists from client's owning account TO the
        #       target user's account (cross-tenant via client_shares).
        # Silently skipping unknown / unauthorized client_ids would hide
        # admin mistakes; instead, reject the whole request when any
        # client_id is invalid so the caller knows to retry.
        target_account_id = target[0]
        rejected = []
        validated = []
        for cid in client_ids:
            cur.execute("SELECT account_id FROM clients WHERE id = %s", (cid,))
            row = cur.fetchone()
            if not row:
                rejected.append({'client_id': cid, 'reason': 'not_found'})
                continue
            owning_account_id = row[0]
            if owning_account_id == target_account_id:
                validated.append(cid)
                continue
            # Cross-tenant — require a share grant.
            cur.execute(
                "SELECT 1 FROM client_shares "
                "WHERE client_id = %s AND shared_with_account_id = %s",
                (cid, target_account_id),
            )
            if cur.fetchone() is not None:
                validated.append(cid)
            else:
                rejected.append({'client_id': cid, 'reason': 'no_share_grant'})

        if rejected:
            cur.close(); conn.close()
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({
                    'error': 'One or more client_ids cannot be assigned to '
                             "this user. Cross-account assignments require a "
                             'share grant first via POST /clients/{id}/shares.',
                    'rejected': rejected,
                }),
            }

        # Delete existing assignments
        cur.execute("DELETE FROM user_client_assignments WHERE user_id = %s", (target_user_id,))

        # Insert validated assignments
        count = 0
        for cid in validated:
            try:
                cur.execute("""
                    INSERT INTO user_client_assignments (user_id, client_id, assigned_by)
                    VALUES (%s, %s, %s)
                """, (target_user_id, cid, caller['user_id']))
                count += 1
            except Exception:
                pass  # FK / unique constraint — should not happen post-validation

        conn.commit()
        cur.close(); conn.close()

        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({'success': True, 'assigned': count})}

    except Exception as e:
        print(f"Set user clients error: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}


def handle_role_change(event):
    """PATCH /auth/invite/role — Change a user's account_role."""
    caller, err = _verify_invite_caller(event)
    if err:
        return err
    try:
        body = json.loads(event.get('body', '{}'))
        target_user_id = body.get('user_id', '').strip()
        new_role = body.get('account_role', '').strip()

        if not target_user_id or not new_role:
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'user_id and account_role are required'})}

        valid_roles = ['super_admin', 'account_admin', 'account_user', 'client_contact', 'contributor']
        if new_role not in valid_roles:
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': f'Invalid role. Must be one of: {", ".join(valid_roles)}'})}

        # Role hierarchy check — cannot promote above own role
        role_hierarchy = {'super_admin': 4, 'account_admin': 3, 'account_user': 2, 'contributor': 1, 'client_contact': 0}
        caller_level = role_hierarchy.get(caller.get('account_role'), 0)
        new_level = role_hierarchy.get(new_role, 0)
        if new_level > caller_level:
            return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Cannot assign a role higher than your own'})}

        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        cur.execute("SELECT account_id, account_role FROM users WHERE id = %s", (target_user_id,))
        target = cur.fetchone()
        if not target:
            cur.close(); conn.close()
            return {'statusCode': 404, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'User not found'})}

        # Scope check
        if caller.get('account_role') == 'account_admin' and str(target[0]) != str(caller.get('account_id')):
            cur.close(); conn.close()
            return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Cannot change roles for users in other accounts'})}

        # Last-admin protection — if demoting from admin, check there's another admin
        if target[1] in ('account_admin', 'super_admin') and new_role not in ('account_admin', 'super_admin'):
            cur.execute("SELECT count(*) FROM users WHERE account_id = %s AND account_role IN ('account_admin', 'super_admin') AND status = 'active' AND id != %s", (target[0], target_user_id))
            admin_count = cur.fetchone()[0]
            if admin_count == 0:
                cur.close(); conn.close()
                return {'statusCode': 409, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Cannot demote the last admin on this account'})}

        cur.execute("UPDATE users SET account_role = %s WHERE id = %s", (new_role, target_user_id))
        conn.commit()
        cur.close(); conn.close()

        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({'success': True, 'account_role': new_role})}
    except Exception as e:
        print(f"Role change error: {e}")
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}
