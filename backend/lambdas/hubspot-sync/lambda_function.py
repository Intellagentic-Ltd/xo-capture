"""
XO Platform - HubSpot Bi-directional Sync Lambda
Private App token auth, push/pull sync between XO Capture and HubSpot CRM.
Routes on HTTP method + path, same pattern as clients lambda.
"""

import json
import os
import time
import hashlib
import secrets
import logging
import urllib.parse
from datetime import datetime, timezone

import requests

from auth_helper import require_auth, get_db_connection, CORS_HEADERS, log_activity
from client_access import can_user_access_client
try:
    from crypto_helper import (
        encrypt, decrypt, unwrap_client_key,
        client_decrypt, client_decrypt_json
    )
except ImportError:
    import json as _json
    def encrypt(x): return x
    def decrypt(x): return x
    def unwrap_client_key(x): return None
    def client_decrypt(k, x): return x
    def client_decrypt_json(k, x):
        if not x: return None
        try: return _json.loads(x)
        except: return None

logger = logging.getLogger('xo.hubspot')
logger.setLevel(logging.INFO)

# ── HubSpot Private App Config ──
HUBSPOT_PRIVATE_TOKEN = os.environ.get('HUBSPOT_PRIVATE_TOKEN', '')
HUBSPOT_WEBHOOK_SECRET = os.environ.get('HUBSPOT_WEBHOOK_SECRET', '')
HUBSPOT_API_BASE = 'https://api.hubapi.com'

# Field mapping: XO clients -> HubSpot Company standard properties
FIELD_MAP_CLIENT_TO_COMPANY = {
    'company_name': 'name',
    'website_url': 'website',
    'description': 'description',
    'company_linkedin': 'linkedin_company_page',
}

# Custom properties in HubSpot (XO field -> HS property name)
CUSTOM_PROPS = {
    'industry': 'xo_industry',
    'future_plans': 'xo_future_plans',
    'status': 'xo_status',
    'source': 'xo_source',
    'nda_signed': 'xo_nda_signed',
    'nda_signed_at': 'xo_nda_signed_at',
    'intellagentic_lead': 'xo_intellagentic_lead',
    'pain_points_json': 'xo_pain_points_json',
    'addresses_json': 'xo_addresses_json',
}

# Custom property definitions to auto-create in HubSpot
CUSTOM_PROPERTY_DEFS = [
    {'name': 'xo_record_type', 'label': 'XO Record Type', 'type': 'string', 'fieldType': 'text',
     'groupName': 'companyinformation', 'description': 'XO Capture record type (client or partner)'},
    {'name': 'xo_client_id', 'label': 'XO Client ID', 'type': 'string', 'fieldType': 'text',
     'groupName': 'companyinformation', 'description': 'XO Capture UUID back-reference'},
    {'name': 'xo_industry', 'label': 'XO Industry', 'type': 'string', 'fieldType': 'text',
     'groupName': 'companyinformation', 'description': 'Industry/vertical (free text from XO Capture)'},
    {'name': 'xo_status', 'label': 'XO Status', 'type': 'string', 'fieldType': 'text',
     'groupName': 'companyinformation', 'description': 'Client status in XO Capture'},
    {'name': 'xo_source', 'label': 'XO Source', 'type': 'string', 'fieldType': 'text',
     'groupName': 'companyinformation', 'description': 'Client source (invite, manual, etc.)'},
    {'name': 'xo_nda_signed', 'label': 'XO NDA Signed', 'type': 'enumeration', 'fieldType': 'booleancheckbox',
     'groupName': 'companyinformation', 'description': 'NDA signed status',
     'options': [{'label': 'True', 'value': 'true'}, {'label': 'False', 'value': 'false'}]},
    {'name': 'xo_nda_signed_at', 'label': 'XO NDA Signed At', 'type': 'datetime', 'fieldType': 'date',
     'groupName': 'companyinformation', 'description': 'When NDA was signed'},
    {'name': 'xo_intellagentic_lead', 'label': 'XO Intellagentic Lead', 'type': 'enumeration', 'fieldType': 'booleancheckbox',
     'groupName': 'companyinformation', 'description': 'Intellagentic lead flag',
     'options': [{'label': 'True', 'value': 'true'}, {'label': 'False', 'value': 'false'}]},
    {'name': 'xo_future_plans', 'label': 'XO Future Plans', 'type': 'string', 'fieldType': 'textarea',
     'groupName': 'companyinformation', 'description': 'Client future plans'},
    {'name': 'xo_pain_points_json', 'label': 'XO Pain Points', 'type': 'string', 'fieldType': 'textarea',
     'groupName': 'companyinformation', 'description': 'JSON array of pain points'},
    {'name': 'xo_addresses_json', 'label': 'XO Addresses', 'type': 'string', 'fieldType': 'textarea',
     'groupName': 'companyinformation', 'description': 'JSON array of addresses'},
    {'name': 'xo_sync_enabled', 'label': 'Sync to XO Capture', 'type': 'enumeration', 'fieldType': 'booleancheckbox',
     'groupName': 'companyinformation', 'description': 'Enable to pull this company into XO Capture during sync',
     'options': [{'label': 'True', 'value': 'true'}, {'label': 'False', 'value': 'false'}]},
]

_properties_ensured = False

def _ensure_custom_properties(access_token):
    """Create custom HubSpot company properties if they don't exist. Runs once per container."""
    global _properties_ensured
    if _properties_ensured:
        return
    for prop_def in CUSTOM_PROPERTY_DEFS:
        try:
            _hubspot_api('POST', '/crm/v3/properties/companies', access_token, json_body=prop_def)
            logger.info("Created HubSpot property: %s", prop_def['name'])
        except requests.exceptions.HTTPError as e:
            if e.response is not None and e.response.status_code == 409:
                pass  # Already exists
            else:
                logger.warning("Failed to create property %s: %s", prop_def['name'], e)
        except Exception as e:
            logger.warning("Failed to create property %s: %s", prop_def['name'], e)
    _properties_ensured = True


    _deal_properties_ensured = True


# ── Auto-migration: add HubSpot columns ──
def _run_hubspot_migrations():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        # Clients table
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS hubspot_company_id VARCHAR(50);")
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS hubspot_contact_id VARCHAR(50);")
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS hubspot_last_sync TIMESTAMP;")
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS hubspot_last_enrichment_id VARCHAR(50);")
        # Partners table
        cur.execute("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS hubspot_company_id VARCHAR(50);")
        cur.execute("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS hubspot_last_sync TIMESTAMP;")
        # system_config table (should already exist from clients lambda)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS system_config (
                id SERIAL PRIMARY KEY,
                config_key VARCHAR(255) UNIQUE NOT NULL,
                config_value TEXT,
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        # Sync log table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS hubspot_sync_log (
                id SERIAL PRIMARY KEY,
                record_type VARCHAR(20) NOT NULL,
                record_id UUID,
                hubspot_id VARCHAR(50),
                sync_direction VARCHAR(10) NOT NULL,
                fields_updated TEXT,
                fields_skipped TEXT,
                details TEXT,
                synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """)
        # Engagement note tracking columns
        cur.execute("ALTER TABLE engagements ADD COLUMN IF NOT EXISTS hubspot_note_id TEXT")
        cur.execute("ALTER TABLE engagements ADD COLUMN IF NOT EXISTS hubspot_synced_at TIMESTAMP")

        # Defensive duplicate of the integrations migration so cold-start order
        # is safe. Canonical owner is clients/lambda_function.py
        # (_run_integrations_migration). If hubspot-sync cold-starts before the
        # clients lambda has run, this self-heals the system_config schema —
        # crucial because _set_config below uses the new ON CONFLICT target.
        # TECH DEBT: long-term, replace inline cold-start migrations with a
        # one-shot migration runner outside the lambdas.
        # HubSpot rows stay account_id IS NULL — see clients lambda comment
        # for the reasoning; do not "fix" the asymmetry.
        cur.execute(
            "ALTER TABLE system_config ADD COLUMN IF NOT EXISTS account_id "
            "INTEGER REFERENCES accounts(id) ON DELETE CASCADE"
        )
        cur.execute(
            "ALTER TABLE system_config "
            "DROP CONSTRAINT IF EXISTS system_config_config_key_key"
        )
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_system_config_account_key "
            "ON system_config (account_id, config_key) NULLS NOT DISTINCT"
        )

        conn.commit()
        # Temporary diagnostic
        cur.execute("SELECT e.name, e.approved_at, e.status, c.company_name FROM engagements e JOIN clients c ON e.client_id = c.id WHERE c.company_name LIKE '%%FC Dyn%%'")
        for r in cur.fetchall():
            print(f"[DIAG] Engagement: name={r[0]}, approved_at={r[1]}, status={r[2]}, client={r[3]}")
        cur.execute("SELECT company_name, approved_at FROM clients WHERE company_name LIKE '%%FC Dyn%%'")
        for r in cur.fetchall():
            print(f"[DIAG] Client: name={r[0]}, approved_at={r[1]}")
        cur.close()
        conn.close()
        print("HubSpot migration complete: hubspot columns + sync_log + engagement note columns ensured")
    except Exception as e:
        print(f"HubSpot migration check (non-fatal): {e}")

_run_hubspot_migrations()


# ── System Config Helpers ──
#
# CONFIG_KEY NAMESPACE CONTRACT (mirrored in shared/integrations_config.py):
#   hubspot_*    → account_id IS NULL  (Intellagentic-only, global)  ← this lambda
#   salesforce_* → account_id IS NOT NULL (per-account)              ← integrations_config.py
#   gong_*       → account_id IS NOT NULL (per-account)              ← integrations_config.py
# Cross-namespace collisions are forbidden. _get_config below is intentionally
# unscoped (WHERE config_key = %s only) — this is safe because only 'hubspot_*'
# rows are NULL-scoped, so no salesforce_*/gong_* row can shadow a hubspot key.
# _set_config writes account_id = NULL explicitly to enforce this on the write side.

def _get_config(conn, key):
    """Read a value from system_config table."""
    cur = conn.cursor()
    cur.execute("SELECT config_value FROM system_config WHERE config_key = %s", (key,))
    row = cur.fetchone()
    cur.close()
    return row[0] if row else None


def _set_config(conn, key, value):
    """Upsert a value in system_config table.
    HubSpot writes NULL account_id (global scope, intentional asymmetry).
    The ON CONFLICT target uses the new (account_id, config_key) NULLS NOT
    DISTINCT index — the legacy UNIQUE(config_key) was dropped by the
    integrations migration."""
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO system_config (account_id, config_key, config_value, updated_at)
        VALUES (NULL, %s, %s, NOW())
        ON CONFLICT (account_id, config_key) DO UPDATE
            SET config_value = EXCLUDED.config_value, updated_at = NOW()
    """, (key, value))
    conn.commit()
    cur.close()


# ── Sync Logging ──

def _log_sync(conn, record_type, record_id, hubspot_id, direction, fields_updated=None,
              fields_skipped=None, details=None):
    """Write an entry to hubspot_sync_log."""
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO hubspot_sync_log (record_type, record_id, hubspot_id, sync_direction,
                                      fields_updated, fields_skipped, details)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
    """, (
        record_type,
        str(record_id) if record_id else None,
        hubspot_id,
        direction,
        json.dumps(fields_updated) if fields_updated else None,
        json.dumps(fields_skipped) if fields_skipped else None,
        details,
    ))
    cur.close()


# Fields compared for conflict detection (XO DB column -> HubSpot property)
SYNC_COMPARE_FIELDS = {
    'company_name': 'name',
    'website_url': 'website',
    'company_linkedin': 'linkedin_company_page',
    'industry': 'xo_industry',
    'description': 'description',
    'future_plans': 'xo_future_plans',
    'status': 'xo_status',
    'source': 'xo_source',
    'pain_points_json': 'xo_pain_points_json',
    'addresses_json': 'xo_addresses_json',
}


def _parse_hs_timestamp(ts_str):
    """Parse a HubSpot ISO timestamp string to a timezone-aware datetime."""
    if not ts_str:
        return None
    try:
        # HubSpot returns millisecond timestamps like "2026-03-28T10:00:00.000Z"
        ts_str = ts_str.replace('Z', '+00:00')
        return datetime.fromisoformat(ts_str)
    except (ValueError, TypeError):
        return None


def _make_aware(dt):
    """Ensure a datetime is timezone-aware (assume UTC if naive)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _determine_sync_direction(xo_updated_at, hs_lastmodified, last_sync):
    """Determine which side wins based on timestamps.

    Returns:
        'first_sync' — hubspot_last_sync is NULL, HubSpot is authoritative
        'push'       — only XO changed since last sync
        'pull'       — only HubSpot changed since last sync
        'conflict'   — both sides changed since last sync
        'none'       — neither side changed
    """
    if last_sync is None:
        return 'first_sync'

    last_sync = _make_aware(last_sync)
    xo_updated_at = _make_aware(xo_updated_at)
    hs_lastmodified = _make_aware(hs_lastmodified)

    xo_changed = xo_updated_at and xo_updated_at > last_sync
    hs_changed = hs_lastmodified and hs_lastmodified > last_sync

    if xo_changed and hs_changed:
        return 'conflict'
    elif xo_changed:
        return 'push'
    elif hs_changed:
        return 'pull'
    else:
        return 'none'


def _detect_field_conflicts(xo_record, hs_props, client_key=None):
    """Compare XO record fields with HubSpot properties. Returns dict of {field: (xo_val, hs_val)}."""
    conflicts = {}
    for xo_field, hs_field in SYNC_COMPARE_FIELDS.items():
        xo_val = xo_record.get(xo_field, '') or ''
        if client_key and xo_val and xo_field not in ('status', 'source'):
            xo_val = _decrypt_field(client_key, xo_val)
        xo_val = str(xo_val).strip() if xo_val else ''

        hs_val = str(hs_props.get(hs_field, '') or '').strip()

        if xo_val != hs_val and (xo_val or hs_val):
            conflicts[xo_field] = (xo_val, hs_val)
    return conflicts


# ── HubSpot Token Management ──

def _get_access_token(conn=None):
    """Return the HubSpot Private App bearer token from env var."""
    return HUBSPOT_PRIVATE_TOKEN or None


def _hubspot_api(method, path, access_token, json_body=None, params=None):
    """Make an authenticated HubSpot CRM API call."""
    url = f"{HUBSPOT_API_BASE}{path}"
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json',
    }
    resp = requests.request(method, url, headers=headers, json=json_body, params=params, timeout=30)
    if not resp.ok:
        error_body = resp.text[:1000] if resp.text else '(empty)'
        if resp.status_code == 409:
            logger.info("HubSpot API %s %s -> 409 (already exists, expected)", method, path)
        else:
            logger.error("HubSpot API %s %s -> %s: %s", method, path, resp.status_code, error_body)
        resp.raise_for_status()
    return resp.json() if resp.content else {}


# ── Client Key Helper ──

def _get_client_key_by_id(cur, db_client_id):
    """Look up and unwrap a client's encryption key by DB id."""
    try:
        cur.execute("SELECT encryption_key FROM clients WHERE id = %s", (db_client_id,))
        row = cur.fetchone()
        if row and row[0]:
            return unwrap_client_key(row[0])
    except Exception as e:
        print(f"Failed to get client key by id (non-fatal): {e}")
    return None


# ── Dedup Logic ──

def _normalize_domain(url):
    """Normalize a URL/domain for dedup comparison.
    Lowercase, strip protocol, www prefix, trailing slashes, and path."""
    if not url:
        return ''
    d = url.lower().strip()
    for prefix in ('https://', 'http://'):
        if d.startswith(prefix):
            d = d[len(prefix):]
            break
    if d.startswith('www.'):
        d = d[4:]
    # Strip path and trailing slashes
    d = d.split('/')[0].rstrip('.')
    return d


def _find_hubspot_company(access_token, domain=None, company_name=None):
    """Search HubSpot for existing company by domain (exact) or name (fuzzy).
    Domain is normalized before search — also searches the website property."""
    normalized = _normalize_domain(domain)

    # Try domain/website match first
    if normalized:
        # Search both 'domain' and 'website' properties
        for prop_name in ('domain', 'website'):
            try:
                resp = _hubspot_api('POST', '/crm/v3/objects/companies/search', access_token, json_body={
                    'filterGroups': [{
                        'filters': [{
                            'propertyName': prop_name,
                            'operator': 'CONTAINS_TOKEN',
                            'value': normalized,
                        }]
                    }],
                    'properties': ['name', 'domain', 'website', 'xo_client_id', 'xo_record_type'],
                    'limit': 10,
                })
                results = resp.get('results', [])
                for r in results:
                    rp = r.get('properties', {})
                    hs_domain = _normalize_domain(rp.get('domain', ''))
                    hs_website = _normalize_domain(rp.get('website', ''))
                    if normalized == hs_domain or normalized == hs_website:
                        return r
            except Exception as e:
                logger.warning("HubSpot %s search failed: %s", prop_name, e)

    # Fall back to company name fuzzy match
    if company_name:
        try:
            resp = _hubspot_api('POST', '/crm/v3/objects/companies/search', access_token, json_body={
                'filterGroups': [{
                    'filters': [{
                        'propertyName': 'name',
                        'operator': 'CONTAINS_TOKEN',
                        'value': company_name,
                    }]
                }],
                'properties': ['name', 'domain', 'website', 'xo_client_id', 'xo_record_type'],
                'limit': 5,
            })
            results = resp.get('results', [])
            if results:
                # Pick best match — exact name match preferred
                for r in results:
                    if r.get('properties', {}).get('name', '').lower() == company_name.lower():
                        return r
                return results[0]
        except Exception as e:
            logger.warning("HubSpot name search failed: %s", e)

    return None


def _find_hubspot_contact(access_token, email):
    """Search HubSpot for existing contact by email."""
    if not email:
        return None
    try:
        resp = _hubspot_api('POST', '/crm/v3/objects/contacts/search', access_token, json_body={
            'filterGroups': [{
                'filters': [{
                    'propertyName': 'email',
                    'operator': 'EQ',
                    'value': email,
                }]
            }],
            'properties': ['firstname', 'lastname', 'email', 'phone', 'jobtitle'],
            'limit': 1,
        })
        results = resp.get('results', [])
        return results[0] if results else None
    except Exception as e:
        logger.warning("HubSpot contact search failed: %s", e)
        return None


# ── Sync: XO -> HubSpot ──

def _split_name(full_name):
    """Split a full name into (first, last)."""
    if not full_name:
        return '', ''
    parts = full_name.strip().split(None, 1)
    return parts[0], parts[1] if len(parts) > 1 else ''


def _decrypt_field(client_key, value):
    """Decrypt a single field value if client_key is available."""
    if client_key and value:
        return client_decrypt(client_key, value)
    return value or ''


def _parse_json_field(client_key, raw):
    """Parse a JSON text field, decrypting first if needed."""
    if not raw:
        return None
    if client_key:
        parsed = client_decrypt_json(client_key, raw)
        if parsed:
            return parsed
    try:
        return json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError):
        return None


def _build_company_properties(record, record_type, client_key=None):
    """Build HubSpot company properties from a DB record dict."""
    props = {'xo_record_type': record_type}

    # Standard fields
    name = record.get('company_name') or record.get('name') or ''
    name = _decrypt_field(client_key, name)
    if name:
        props['name'] = name

    website = record.get('website_url') or record.get('website') or ''
    website = _decrypt_field(client_key, website)
    if website:
        props['website'] = website

    company_linkedin = record.get('company_linkedin', '') or ''
    if company_linkedin:
        props['linkedin_company_page'] = company_linkedin

    industry = _decrypt_field(client_key, record.get('industry', ''))
    if industry:
        props['xo_industry'] = industry

    description = _decrypt_field(client_key, record.get('description', ''))
    if description:
        props['description'] = description

    # Custom properties
    future_plans = _decrypt_field(client_key, record.get('future_plans', ''))
    if future_plans:
        props['xo_future_plans'] = future_plans

    if 'status' in record and record['status']:
        props['xo_status'] = record['status']

    if 'source' in record and record['source']:
        props['xo_source'] = record['source']

    if 'nda_signed' in record and record['nda_signed'] is not None:
        props['xo_nda_signed'] = str(record['nda_signed']).lower()

    if 'nda_signed_at' in record and record['nda_signed_at']:
        nda_at = record['nda_signed_at']
        # HubSpot datetime properties expect Unix epoch milliseconds
        if hasattr(nda_at, 'timestamp'):
            props['xo_nda_signed_at'] = str(int(nda_at.timestamp() * 1000))
        else:
            try:
                from datetime import datetime as _dt
                parsed = _dt.fromisoformat(str(nda_at).replace('Z', '+00:00'))
                props['xo_nda_signed_at'] = str(int(parsed.timestamp() * 1000))
            except (ValueError, TypeError):
                pass  # Skip if unparseable

    if 'intellagentic_lead' in record and record['intellagentic_lead'] is not None:
        props['xo_intellagentic_lead'] = str(record['intellagentic_lead']).lower()

    # pain_points_json -> custom property (full JSON text)
    pain_points_raw = record.get('pain_points_json', '')
    if pain_points_raw:
        pain_points = _parse_json_field(client_key, pain_points_raw)
        if pain_points:
            props['xo_pain_points_json'] = json.dumps(pain_points)

    # addresses_json -> custom property (full JSON text) + standard address from first entry
    addresses_raw = record.get('addresses_json')
    if addresses_raw:
        addresses = _parse_json_field(client_key, addresses_raw)
        if addresses and isinstance(addresses, list):
            props['xo_addresses_json'] = json.dumps(addresses)
            if len(addresses) > 0:
                addr = addresses[0]
                if addr.get('address1'):
                    props['address'] = addr['address1']
                if addr.get('address2'):
                    props['address2'] = addr['address2']
                if addr.get('city'):
                    props['city'] = addr['city']
                if addr.get('state'):
                    props['state'] = addr['state']
                if addr.get('postalCode'):
                    props['zip'] = addr['postalCode']
                if addr.get('country'):
                    props['country'] = addr['country']

    # XO client ID for back-reference
    if record.get('id'):
        props['xo_client_id'] = str(record['id'])

    return props


HONORIFICS = {'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sir', 'dame', 'rev', 'lord', 'lady'}


def _build_contact_properties_from_obj(contact_obj, client_key=None):
    """Build HubSpot contact properties from a single contact JSON object.
    Handles both {name} (combined) and {firstName, lastName} (separate) patterns."""
    props = {}

    # Try separate firstName/lastName first, fall back to combined name
    first = _decrypt_field(client_key, contact_obj.get('firstName', ''))
    last = _decrypt_field(client_key, contact_obj.get('lastName', ''))
    if not first and not last:
        name = _decrypt_field(client_key, contact_obj.get('name', ''))
        first, last = _split_name(name)
    if first:
        props['firstname'] = first
    if last:
        props['lastname'] = last

    email = _decrypt_field(client_key, contact_obj.get('email', ''))
    if email:
        props['email'] = email

    phone = _decrypt_field(client_key, contact_obj.get('phone', ''))
    if phone:
        props['phone'] = phone

    # Only push title as jobtitle if it's an actual job title (not an honorific)
    title = _decrypt_field(client_key, contact_obj.get('title', ''))
    if title and title.lower().rstrip('.') not in HONORIFICS:
        props['jobtitle'] = title

    # LinkedIn URL
    linkedin = _decrypt_field(client_key, contact_obj.get('linkedin', ''))
    if linkedin:
        props['linkedinbio'] = linkedin

    return props


def _push_company(access_token, record, record_type, client_key=None):
    """Push a single company record to HubSpot (create or update). Returns HubSpot company ID."""
    props = _build_company_properties(record, record_type, client_key)
    hs_id = record.get('hubspot_company_id')

    domain = props.get('website') or props.get('domain')
    name = props.get('name')

    if not hs_id:
        # Check for existing company in HubSpot (dedup)
        existing = _find_hubspot_company(access_token, domain=domain, company_name=name)
        if existing:
            hs_id = existing['id']

    if hs_id:
        # Update existing
        _hubspot_api('PATCH', f'/crm/v3/objects/companies/{hs_id}', access_token, json_body={'properties': props})
        logger.info("Updated HubSpot company %s (%s)", hs_id, name)
    else:
        # Create new
        resp = _hubspot_api('POST', '/crm/v3/objects/companies', access_token, json_body={'properties': props})
        hs_id = resp['id']
        logger.info("Created HubSpot company %s (%s)", hs_id, name)

    return hs_id


def _push_single_contact(access_token, contact_props, company_id, existing_hs_id=None):
    """Push one contact to HubSpot and associate with company. Returns HubSpot contact ID."""
    if not contact_props.get('email'):
        return None

    hs_contact_id = existing_hs_id
    existing_contact = None

    if not hs_contact_id:
        existing_contact = _find_hubspot_contact(access_token, contact_props.get('email'))
        if existing_contact:
            hs_contact_id = existing_contact['id']

    if hs_contact_id:
        # Don't overwrite a HubSpot phone that has a country code with one that doesn't
        if 'phone' in contact_props:
            hs_phone = ''
            if existing_contact:
                hs_phone = existing_contact.get('properties', {}).get('phone') or ''
            elif existing_hs_id:
                # Fetch current phone from HubSpot
                try:
                    hs_data = _hubspot_api('GET', f'/crm/v3/objects/contacts/{hs_contact_id}', access_token,
                                           params={'properties': 'phone'})
                    hs_phone = hs_data.get('properties', {}).get('phone') or ''
                except Exception:
                    pass
            contact_props['phone'] = _prefer_phone(contact_props.get('phone', ''), hs_phone)
        _hubspot_api('PATCH', f'/crm/v3/objects/contacts/{hs_contact_id}', access_token, json_body={'properties': contact_props})
        logger.info("Updated HubSpot contact %s (%s)", hs_contact_id, contact_props.get('email'))
    else:
        resp = _hubspot_api('POST', '/crm/v3/objects/contacts', access_token, json_body={'properties': contact_props})
        hs_contact_id = resp['id']
        logger.info("Created HubSpot contact %s (%s)", hs_contact_id, contact_props.get('email'))

    # Associate contact with company
    if company_id:
        try:
            _hubspot_api('PUT',
                f'/crm/v3/objects/contacts/{hs_contact_id}/associations/companies/{company_id}/contact_to_company',
                access_token)
        except Exception as e:
            logger.warning("Failed to associate contact %s with company %s: %s", hs_contact_id, company_id, e)

    return hs_contact_id


def _push_contacts(access_token, record, company_id, client_key=None):
    """Push all contacts from contacts_json to HubSpot. Returns primary (first) contact ID."""
    contacts_raw = record.get('contacts_json')
    contacts = _parse_json_field(client_key, contacts_raw) if contacts_raw else None
    if not contacts or not isinstance(contacts, list):
        return None

    primary_hs_id = None
    for i, contact_obj in enumerate(contacts):
        props = _build_contact_properties_from_obj(contact_obj, client_key)
        if not props.get('email'):
            continue
        # Only the first contact uses the stored hubspot_contact_id
        existing_id = record.get('hubspot_contact_id') if i == 0 else None
        try:
            hs_id = _push_single_contact(access_token, props, company_id, existing_hs_id=existing_id)
            if i == 0:
                primary_hs_id = hs_id
        except Exception as e:
            logger.warning("Failed to push contact %s: %s", props.get('email', '?'), e)

    return primary_hs_id


def _create_company_association(access_token, from_company_id, to_company_id, label='Channel Partner'):
    """Create a company-to-company association in HubSpot."""
    try:
        _hubspot_api('PUT',
            f'/crm/v3/objects/companies/{from_company_id}/associations/companies/{to_company_id}/company_to_company',
            access_token)
        logger.info("Associated company %s -> %s (%s)", from_company_id, to_company_id, label)
    except Exception as e:
        logger.warning("Failed to create company association %s -> %s: %s", from_company_id, to_company_id, e)


def _push_engagement_results_for_client(access_token, cur, conn, db_client_id, client_name, company_hs_id, client_key=None):
    """Push approved engagement results as HubSpot Notes on the Company."""
    import boto3
    s3 = boto3.client('s3')
    bucket = os.environ.get('BUCKET_NAME', 'xo-client-data-mv')

    # Get s3_folder for this client
    cur.execute("SELECT s3_folder FROM clients WHERE id = %s", (db_client_id,))
    folder_row = cur.fetchone()
    s3_folder = folder_row[0] if folder_row else None
    if not s3_folder:
        return 0

    cur.execute("""
        SELECT id, name, focus_area, approved_at, hubspot_note_id, hubspot_synced_at
        FROM engagements
        WHERE client_id = %s AND approved_at IS NOT NULL
    """, (db_client_id,))
    rows = cur.fetchall()
    cols = ['id', 'name', 'focus_area', 'approved_at', 'hubspot_note_id', 'hubspot_synced_at']
    synced = 0

    for row in rows:
        eng = dict(zip(cols, row))
        try:
            # Skip if already synced and approved_at hasn't changed
            if eng['hubspot_synced_at'] and eng['approved_at']:
                synced_at = eng['hubspot_synced_at'].replace(tzinfo=timezone.utc) if eng['hubspot_synced_at'].tzinfo is None else eng['hubspot_synced_at']
                approved_at = eng['approved_at'].replace(tzinfo=timezone.utc) if eng['approved_at'].tzinfo is None else eng['approved_at']
                if synced_at >= approved_at:
                    continue

            # Read analysis.json — try engagement-scoped path first
            results = None
            for s3_key in [
                f"{s3_folder}/engagements/{eng['id']}/results/analysis.json",
                f"{s3_folder}/results/analysis.json",
            ]:
                try:
                    obj = s3.get_object(Bucket=bucket, Key=s3_key)
                    body = obj['Body'].read()
                    # Try decrypt if client_key available
                    if client_key:
                        try:
                            from crypto_helper import decrypt_s3_body
                            body = decrypt_s3_body(client_key, body)
                        except Exception:
                            body = body.decode('utf-8', errors='replace') if isinstance(body, bytes) else body
                    else:
                        body = body.decode('utf-8', errors='replace') if isinstance(body, bytes) else body
                    results = json.loads(body)
                    break
                except Exception:
                    continue

            if not results:
                continue

            # Build note body
            eng_name = eng['name'] or 'Engagement'
            focus = eng['focus_area'] or ''
            summary = results.get('client_summary', '') or results.get('summary', '')
            streamline = results.get('streamline_applications', '')

            note_html = f"<h3>XO Capture Engagement: {eng_name}</h3>"
            if focus:
                note_html += f"<p><strong>Focus:</strong> {focus}</p>"
            if summary:
                note_html += f"<h4>Opportunities</h4><p>{summary[:2000]}</p>"
            if streamline:
                note_html += f"<h4>Potential Streamline + XO Applications</h4><p>{streamline[:2000]}</p>"
            note_html += f'<p><a href="https://xo.intellagentic.io">View full results in XO Capture</a></p>'

            note_props = {
                'hs_note_body': note_html,
                'hs_timestamp': datetime.now(timezone.utc).isoformat(),
            }

            if eng['hubspot_note_id']:
                # Update existing note
                _hubspot_api('PATCH', f"/crm/v3/objects/notes/{eng['hubspot_note_id']}", access_token,
                             json_body={'properties': note_props})
                logger.info("Updated HubSpot note %s for engagement %s", eng['hubspot_note_id'], eng_name)
            else:
                # Create new note
                resp = _hubspot_api('POST', '/crm/v3/objects/notes', access_token,
                                    json_body={'properties': note_props})
                note_id = resp.get('id')
                if note_id and company_hs_id:
                    try:
                        _hubspot_api('PUT',
                            f'/crm/v3/objects/notes/{note_id}/associations/companies/{company_hs_id}/note_to_company',
                            access_token)
                    except Exception as e:
                        logger.warning("Failed to associate note %s with company: %s", note_id, e)
                eng['hubspot_note_id'] = note_id
                logger.info("Created HubSpot note %s for engagement %s", note_id, eng_name)

            # Update tracking
            cur.execute("UPDATE engagements SET hubspot_note_id = %s, hubspot_synced_at = NOW() WHERE id = %s",
                        (eng['hubspot_note_id'], eng['id']))
            conn.commit()
            synced += 1

        except Exception as e:
            logger.warning("Failed to push engagement results %s: %s", eng.get('name', '?'), e)

    return synced


def _push_enrichment_note(access_token, company_id, client_record, client_key=None):
    """Push latest enrichment summary as a Note on the HubSpot Company.
    Only creates a Note if the enrichment is new (not already pushed)."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT id, results_s3_key FROM enrichments
            WHERE client_id = %s AND status = 'complete'
            ORDER BY completed_at DESC LIMIT 1
        """, (str(client_record['id']),))
        row = cur.fetchone()
        if not row:
            return

        enrichment_id = str(row[0])
        results_key = row[1]

        # Check if this enrichment was already pushed as a note
        cur.execute("""
            SELECT hubspot_last_enrichment_id FROM clients WHERE id = %s
        """, (str(client_record['id']),))
        client_row = cur.fetchone()
        last_pushed_id = client_row[0] if client_row else None

        if last_pushed_id == enrichment_id:
            return  # Already pushed this enrichment

        # Read results from S3
        import boto3
        s3 = boto3.client('s3')
        bucket = os.environ.get('BUCKET_NAME', 'xo-client-data-mv')
        obj = s3.get_object(Bucket=bucket, Key=results_key)
        body = obj['Body'].read().decode('utf-8')

        try:
            results = json.loads(body)
        except json.JSONDecodeError:
            return

        summary = results.get('summary', '')
        bottom_line = results.get('bottom_line', '')
        if not summary and not bottom_line:
            return

        note_body = f"**XO Capture Enrichment Summary**\n\n"
        if bottom_line:
            note_body += f"**Bottom Line:** {bottom_line}\n\n"
        if summary:
            note_body += f"{summary}"

        # Create engagement note via v3 API
        note_props = {
            'hs_note_body': note_body,
            'hs_timestamp': datetime.now(timezone.utc).isoformat(),
        }
        resp = _hubspot_api('POST', '/crm/v3/objects/notes', access_token, json_body={
            'properties': note_props,
        })
        note_id = resp.get('id')

        if note_id and company_id:
            try:
                _hubspot_api('PUT',
                    f'/crm/v3/objects/notes/{note_id}/associations/companies/{company_id}/note_to_company',
                    access_token)
            except Exception as e:
                logger.warning("Failed to associate note with company: %s", e)

        # Mark this enrichment as pushed
        cur.execute("UPDATE clients SET hubspot_last_enrichment_id = %s WHERE id = %s",
                    (enrichment_id, str(client_record['id'])))
        conn.commit()
        logger.info("Pushed enrichment note for client %s (enrichment %s)", client_record['id'], enrichment_id)

    except Exception as e:
        logger.warning("Failed to push enrichment note: %s", e)
    finally:
        cur.close()
        conn.close()


# ── Sync: HubSpot -> XO ──

def _pull_companies(access_token, conn, record_type='client'):
    """Pull companies from HubSpot with given xo_record_type into XO.
    Returns (created, updated, conflicts_list)."""
    cur = conn.cursor()
    created = 0
    updated = 0
    conflicts_list = []

    try:
        after = None
        while True:
            params = {
                'limit': 100,
                'properties': 'name,website,description,xo_industry,'
                              'xo_client_id,xo_record_type,xo_status,xo_source,'
                              'xo_nda_signed,xo_nda_signed_at,xo_intellagentic_lead,'
                              'xo_future_plans,xo_pain_points_json,xo_addresses_json,xo_sync_enabled,'
                              'address,address2,city,state,zip,country,'
                              'hs_lastmodifieddate',
            }
            if after:
                params['after'] = after

            resp = _hubspot_api('GET', '/crm/v3/objects/companies', access_token, params=params)
            results = resp.get('results', [])

            for company in results:
                props = company.get('properties', {})
                hs_record_type = props.get('xo_record_type', '')
                sync_enabled = (props.get('xo_sync_enabled', '') or '').lower() == 'true'
                xo_id = props.get('xo_client_id')

                # Process if: matches record_type, OR has xo_sync_enabled and is a client pull
                if hs_record_type == record_type:
                    pass  # explicit match — process
                elif record_type == 'client' and sync_enabled and not hs_record_type:
                    pass  # tagged for sync, no record_type yet — treat as client
                else:
                    continue

                hs_id = company['id']

                if record_type == 'client':
                    action, conflict = _pull_client_record(cur, conn, hs_id, xo_id, props)
                    if conflict:
                        conflicts_list.append(conflict)
                    if action == 'created':
                        created += 1
                    elif action == 'updated':
                        updated += 1
                    # Merge contacts from HubSpot into XO contacts_json
                    resolved_xo_id = xo_id
                    if not resolved_xo_id:
                        cur.execute("SELECT id FROM clients WHERE hubspot_company_id = %s", (hs_id,))
                        id_row = cur.fetchone()
                        resolved_xo_id = str(id_row[0]) if id_row else None
                    if resolved_xo_id:
                        _pull_contacts_for_company(access_token, conn, hs_id, resolved_xo_id)
                elif record_type == 'partner':
                    _pull_account_record(cur, conn, hs_id, xo_id, props)

            # Pagination
            paging = resp.get('paging', {})
            next_page = paging.get('next', {})
            after = next_page.get('after')
            if not after:
                break

        conn.commit()
    except Exception as e:
        logger.error("Failed to pull %s companies from HubSpot: %s", record_type, e)
        conn.rollback()
    finally:
        cur.close()

    return created, updated, conflicts_list


def _apply_hs_to_xo_update(cur, hs_id, xo_id, props, where_clause, where_params):
    """Apply HubSpot property values to an XO client record (pull update)."""
    name = props.get('name', '')
    website = props.get('website', '')
    company_linkedin = props.get('linkedin_company_page', '')
    industry = props.get('xo_industry', '')
    description = props.get('description', '')
    status = props.get('xo_status', '')
    source = props.get('xo_source', '')
    future_plans = props.get('xo_future_plans', '')
    nda_signed = props.get('xo_nda_signed', '')
    intellagentic_lead = props.get('xo_intellagentic_lead', '')
    pain_points = props.get('xo_pain_points_json', '')
    addresses = props.get('xo_addresses_json', '')
    nda_bool = nda_signed.lower() == 'true' if nda_signed else None
    lead_bool = intellagentic_lead.lower() == 'true' if intellagentic_lead else None

    cur.execute(f"""
        UPDATE clients SET
            company_name = COALESCE(NULLIF(%s, ''), company_name),
            website_url = COALESCE(NULLIF(%s, ''), website_url),
            company_linkedin = COALESCE(NULLIF(%s, ''), company_linkedin),
            industry = COALESCE(NULLIF(%s, ''), industry),
            description = COALESCE(NULLIF(%s, ''), description),
            future_plans = COALESCE(NULLIF(%s, ''), future_plans),
            status = COALESCE(NULLIF(%s, ''), status),
            source = COALESCE(NULLIF(%s, ''), source),
            nda_signed = COALESCE(%s, nda_signed),
            intellagentic_lead = COALESCE(%s, intellagentic_lead),
            pain_points_json = COALESCE(NULLIF(%s, ''), pain_points_json),
            addresses_json = COALESCE(NULLIF(%s, ''), addresses_json),
            hubspot_company_id = %s,
            hubspot_last_sync = NOW()
        WHERE {where_clause}
    """, (name, website, company_linkedin, industry, description, future_plans,
          status, source, nda_bool, lead_bool, pain_points, addresses,
          hs_id, *where_params))

    # Return list of fields that had values
    updated_fields = []
    for label, val in [('company_name', name), ('website_url', website), ('company_linkedin', company_linkedin), ('industry', industry),
                       ('description', description), ('future_plans', future_plans),
                       ('status', status), ('source', source), ('pain_points_json', pain_points),
                       ('addresses_json', addresses)]:
        if val:
            updated_fields.append(label)
    if nda_bool is not None:
        updated_fields.append('nda_signed')
    if lead_bool is not None:
        updated_fields.append('intellagentic_lead')
    return updated_fields


def _pull_client_record(cur, conn, hs_id, xo_id, props):
    """Create or update a client record from HubSpot company data.
    Uses timestamp-based conflict resolution.
    Returns (action, conflict_dict) where action is 'created', 'updated', 'conflict', or None."""
    name = props.get('name', '')
    website = props.get('website', '')
    hs_lastmodified = _parse_hs_timestamp(props.get('hs_lastmodifieddate'))

    # --- New record: no xo_id and no existing link ---
    if not xo_id:
        cur.execute("SELECT id, hubspot_last_sync, updated_at FROM clients WHERE hubspot_company_id = %s", (hs_id,))
        existing = cur.fetchone()
        if existing:
            xo_id = str(existing[0])
            last_sync = existing[1]
            xo_updated_at = existing[2]
        else:
            # Only create new XO records if xo_sync_enabled is true
            sync_enabled = (props.get('xo_sync_enabled', '') or '').lower() == 'true'
            if not sync_enabled:
                return None, None
            # Brand new record from HubSpot — create it
            s3_folder = f"hubspot-{hs_id}-{int(time.time())}"
            status_val = props.get('xo_status', '') or 'active'
            nda_str = props.get('xo_nda_signed', '')
            nda_bool = nda_str.lower() == 'true' if nda_str else None
            lead_str = props.get('xo_intellagentic_lead', '')
            lead_bool = lead_str.lower() == 'true' if lead_str else None

            cur.execute("""
                INSERT INTO clients (company_name, website_url, industry, description,
                                     future_plans, status, source, nda_signed, intellagentic_lead,
                                     pain_points_json, addresses_json, s3_folder,
                                     hubspot_company_id, hubspot_last_sync)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                RETURNING id
            """, (name, website, props.get('xo_industry', ''), props.get('description', ''),
                  props.get('xo_future_plans', ''), status_val, props.get('xo_source', ''),
                  nda_bool, lead_bool, props.get('xo_pain_points_json', ''),
                  props.get('xo_addresses_json', ''), s3_folder, hs_id))
            new_row = cur.fetchone()
            new_id = str(new_row[0]) if new_row else None

            all_fields = [f for f in SYNC_COMPARE_FIELDS.keys() if props.get(SYNC_COMPARE_FIELDS[f])]
            _log_sync(conn, 'client', new_id, hs_id, 'pull', fields_updated=all_fields,
                      details=f"New client created from HubSpot: {name}")
            return 'created', None
    else:
        # Existing xo_id — look up timestamps
        cur.execute("SELECT hubspot_last_sync, updated_at FROM clients WHERE id = %s", (xo_id,))
        row = cur.fetchone()
        if not row:
            return None, None
        last_sync = row[0]
        xo_updated_at = row[1]

    # --- Determine sync direction ---
    direction = _determine_sync_direction(xo_updated_at, hs_lastmodified, last_sync)

    if direction == 'first_sync' or direction == 'pull':
        # HubSpot wins — apply all fields
        updated_fields = _apply_hs_to_xo_update(cur, hs_id, xo_id, props, 'id = %s', (xo_id,))
        _log_sync(conn, 'client', xo_id, hs_id, 'pull', fields_updated=updated_fields,
                  details=f"{'First sync' if direction == 'first_sync' else 'HubSpot newer'}: {name}")
        return ('updated' if updated_fields else None), None

    elif direction == 'push':
        # XO wins — just update hubspot_last_sync, don't overwrite XO
        cur.execute("UPDATE clients SET hubspot_last_sync = NOW() WHERE id = %s", (xo_id,))
        _log_sync(conn, 'client', xo_id, hs_id, 'push',
                  details=f"XO newer, skipped pull: {name}")
        return None, None

    elif direction == 'conflict':
        # Both sides changed — detect which fields conflict
        # Read current XO record for comparison
        cur.execute("""
            SELECT company_name, website_url, company_linkedin, industry, description, future_plans,
                   status, source, pain_points_json, addresses_json, encryption_key
            FROM clients WHERE id = %s
        """, (xo_id,))
        xo_row = cur.fetchone()
        if not xo_row:
            return None, None
        xo_cols = ['company_name', 'website_url', 'company_linkedin', 'industry', 'description', 'future_plans',
                    'status', 'source', 'pain_points_json', 'addresses_json', 'encryption_key']
        xo_record = dict(zip(xo_cols, xo_row))
        client_key = unwrap_client_key(xo_record.pop('encryption_key', None))

        field_conflicts = _detect_field_conflicts(xo_record, props, client_key)
        if not field_conflicts:
            # No actual field differences — just update sync timestamp
            cur.execute("UPDATE clients SET hubspot_last_sync = NOW() WHERE id = %s", (xo_id,))
            return None, None

        conflicting_fields = list(field_conflicts.keys())
        details_parts = []
        for f, (xo_v, hs_v) in field_conflicts.items():
            xo_display = (xo_v[:80] + '...') if len(xo_v) > 80 else xo_v
            hs_display = (hs_v[:80] + '...') if len(hs_v) > 80 else hs_v
            details_parts.append(f"{f}: XO=\"{xo_display}\" vs HS=\"{hs_display}\"")

        details_text = f"Conflict on {name}: " + "; ".join(details_parts)

        _log_sync(conn, 'client', xo_id, hs_id, 'conflict',
                  fields_skipped=conflicting_fields, details=details_text)

        logger.warning("Conflict detected for client %s (%s): %s", xo_id, name, conflicting_fields)
        return 'conflict', {
            'record_type': 'client',
            'record_id': str(xo_id),
            'hubspot_id': hs_id,
            'company_name': name,
            'conflicting_fields': conflicting_fields,
            'details': details_text,
        }

    # direction == 'none'
    return None, None


def _pull_account_record(cur, conn, hs_id, xo_id, props):
    """Create or update an account record from HubSpot company data."""
    name = props.get('name', '')

    if xo_id:
        cur.execute("""
            UPDATE accounts SET
                name = COALESCE(NULLIF(%s, ''), name),
                hubspot_company_id = %s,
                hubspot_last_sync = NOW()
            WHERE id = %s
        """, (name, hs_id, xo_id))
    else:
        cur.execute("SELECT id FROM accounts WHERE hubspot_company_id = %s", (hs_id,))
        existing = cur.fetchone()
        if existing:
            cur.execute("""
                UPDATE accounts SET
                    name = COALESCE(NULLIF(%s, ''), name),
                    hubspot_last_sync = NOW()
                WHERE hubspot_company_id = %s
            """, (name, hs_id))
        else:
            cur.execute("""
                INSERT INTO accounts (name, hubspot_company_id, hubspot_last_sync)
                VALUES (%s, %s, NOW())
            """, (name, hs_id))


def _prefer_phone(phone_a, phone_b):
    """Return the better phone value. Prefer the one with a country code (starts with +).
    If both or neither have a country code, prefer phone_a (the existing value)."""
    if not phone_a:
        return phone_b
    if not phone_b:
        return phone_a
    a_has_code = phone_a.strip().startswith('+')
    b_has_code = phone_b.strip().startswith('+')
    if b_has_code and not a_has_code:
        return phone_b
    return phone_a


def _merge_contact(xo_contact, hs_contact):
    """Merge a HubSpot contact into an XO contact, filling in missing fields only.
    XO values are preserved; HubSpot values fill gaps.
    For phone: prefer whichever has a country code."""
    merged = dict(xo_contact)
    for key, value in hs_contact.items():
        if key == 'phone':
            merged['phone'] = _prefer_phone(merged.get('phone', ''), value)
        elif value and not merged.get(key):
            merged[key] = value
    return merged


def _match_contacts(xo_contacts, hs_contacts):
    """Match XO contacts to HubSpot contacts by email or firstName.
    Returns merged list preserving XO data with HubSpot filling gaps."""
    if not xo_contacts:
        return hs_contacts

    merged = []
    hs_remaining = list(hs_contacts)

    for xo_c in xo_contacts:
        xo_email = (xo_c.get('email') or '').lower().strip()
        xo_first = (xo_c.get('firstName') or '').lower().strip()
        if not xo_first:
            # Fall back to first word of combined name field
            xo_name = xo_c.get('name') or ''
            xo_first = xo_name.split()[0].lower() if xo_name.strip() else ''

        matched_hs = None
        for j, hs_c in enumerate(hs_remaining):
            hs_email = (hs_c.get('email') or '').lower().strip()
            hs_first = (hs_c.get('firstName') or '').lower().strip()

            # Match on email if both have one
            if xo_email and hs_email and xo_email == hs_email:
                matched_hs = hs_remaining.pop(j)
                break
            # Match on firstName if both have one
            if xo_first and hs_first and xo_first == hs_first:
                matched_hs = hs_remaining.pop(j)
                break

        if matched_hs:
            merged.append(_merge_contact(xo_c, matched_hs))
        else:
            merged.append(xo_c)

    # Append any unmatched HubSpot contacts (new contacts from HubSpot)
    merged.extend(hs_remaining)
    return merged


def _pull_contacts_for_company(access_token, conn, hs_company_id, xo_client_id):
    """Pull associated contacts from HubSpot and merge into XO client contacts_json.
    Fills in missing fields without overwriting existing XO values."""
    if not xo_client_id:
        return
    try:
        resp = _hubspot_api('GET',
            f'/crm/v3/objects/companies/{hs_company_id}/associations/contacts',
            access_token)
        assoc_results = resp.get('results', [])
        if not assoc_results:
            return

        hs_contacts = []
        primary_hs_contact_id = None

        for i, assoc in enumerate(assoc_results):
            contact_id = assoc.get('id')
            if not contact_id:
                continue
            try:
                contact = _hubspot_api('GET', f'/crm/v3/objects/contacts/{contact_id}', access_token,
                                       params={'properties': 'firstname,lastname,email,phone,jobtitle,linkedinbio'})
                props = contact.get('properties', {})

                contact_obj = {
                    'firstName': props.get('firstname', ''),
                    'lastName': props.get('lastname', ''),
                    'email': props.get('email', ''),
                    'phone': props.get('phone', ''),
                    'title': props.get('jobtitle', ''),
                    'linkedin': props.get('linkedinbio', ''),
                }
                # Remove empty values to keep JSON clean
                contact_obj = {k: v for k, v in contact_obj.items() if v}
                hs_contacts.append(contact_obj)

                if i == 0:
                    primary_hs_contact_id = contact_id
            except Exception as e:
                logger.warning("Failed to fetch contact %s: %s", contact_id, e)

        if not hs_contacts:
            return

        # Read existing XO contacts_json and merge
        cur = conn.cursor()
        cur.execute("SELECT contacts_json, encryption_key FROM clients WHERE id = %s", (xo_client_id,))
        row = cur.fetchone()
        xo_contacts = []
        if row and row[0]:
            client_key = unwrap_client_key(row[1]) if row[1] else None
            xo_contacts = _parse_json_field(client_key, row[0]) or []

        merged = _match_contacts(xo_contacts, hs_contacts)

        cur.execute("""
            UPDATE clients SET
                contacts_json = %s,
                hubspot_contact_id = COALESCE(%s, hubspot_contact_id)
            WHERE id = %s
        """, (json.dumps(merged), primary_hs_contact_id, xo_client_id))
        conn.commit()
        cur.close()
    except Exception as e:
        logger.warning("Failed to pull contacts for company %s: %s", hs_company_id, e)


# ── Route Handlers ──

def handle_connect(event, user):
    """POST /hubspot/connect — Private App tokens are configured server-side."""
    return {
        'statusCode': 200,
        'headers': CORS_HEADERS,
        'body': json.dumps({
            'status': 'private_app',
            'message': 'HubSpot integration uses a Private App token configured server-side. No OAuth flow required.',
            'connected': bool(HUBSPOT_PRIVATE_TOKEN),
        })
    }


def handle_callback(event):
    """GET /hubspot/callback — Not used with Private App auth."""
    return {
        'statusCode': 200,
        'headers': CORS_HEADERS,
        'body': json.dumps({
            'status': 'private_app',
            'message': 'HubSpot integration uses a Private App token. OAuth callback is not required.',
        })
    }


def handle_status(event, user):
    """GET /hubspot/status — Check connectivity with a test read against HubSpot."""
    token = _get_access_token()
    if not token:
        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({
                'connected': False,
                'last_sync': None,
                'error': 'HUBSPOT_PRIVATE_TOKEN env var not set',
            })
        }

    # Test connectivity with a lightweight read
    connected = False
    error_msg = None
    try:
        resp = _hubspot_api('GET', '/crm/v3/objects/companies', token, params={'limit': 1})
        connected = True
    except Exception as e:
        error_msg = str(e)

    conn = get_db_connection()
    try:
        last_sync = _get_config(conn, 'hubspot_last_full_sync')
        intellagentic_id = _get_config(conn, 'hubspot_intellagentic_company_id')

        result = {
            'connected': connected,
            'auth_type': 'private_app',
            'last_sync': last_sync,
            'intellagentic_company_id': intellagentic_id,
        }
        if error_msg:
            result['error'] = error_msg

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps(result)
        }
    finally:
        conn.close()


def handle_sync(event, user):
    """POST /hubspot/sync — Full bi-directional sync."""
    conn = get_db_connection()
    try:
        access_token = _get_access_token()
        if not access_token:
            return {
                'statusCode': 401,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'HUBSPOT_PRIVATE_TOKEN not configured'})
            }

        # Ensure custom properties exist in HubSpot
        _ensure_custom_properties(access_token)

        intellagentic_company_id = _get_config(conn, 'hubspot_intellagentic_company_id')

        # ── Phase 1: Push XO -> HubSpot (only changed records) ──
        cur = conn.cursor()
        api_calls = {'before': 0, 'after': 0}

        # Push accounts — only those changed since last sync
        cur.execute("""
            SELECT id, name, company, email, website, hubspot_company_id,
                   contacts_json, addresses_json
            FROM accounts
            WHERE hubspot_last_sync IS NULL OR updated_at > hubspot_last_sync
        """)
        account_rows = cur.fetchall()
        account_cols = ['id', 'name', 'company', 'email', 'website', 'hubspot_company_id',
                        'contacts_json', 'addresses_json']
        accounts_pushed = 0
        account_hs_map = {}

        # Also load all account hubspot IDs for association mapping
        cur.execute("SELECT id, hubspot_company_id FROM accounts WHERE hubspot_company_id IS NOT NULL")
        for pid, phsid in cur.fetchall():
            account_hs_map[pid] = phsid

        # Batch: separate creates vs updates
        account_creates = []
        account_updates = []
        for row in account_rows:
            record = dict(zip(account_cols, row))
            props = _build_company_properties(record, 'partner')
            if record.get('hubspot_company_id'):
                account_updates.append({'id': record['hubspot_company_id'], 'properties': props, '_xo_id': record['id']})
            else:
                account_creates.append({'properties': props, '_xo_id': record['id']})

        # Batch create accounts
        if account_creates:
            try:
                batch_body = {'inputs': [{'properties': c['properties']} for c in account_creates]}
                resp = _hubspot_api('POST', '/crm/v3/objects/companies/batch/create', access_token, json_body=batch_body)
                api_calls['after'] += 1
                for i, result in enumerate(resp.get('results', [])):
                    hs_id = result['id']
                    xo_id = account_creates[i]['_xo_id']
                    account_hs_map[xo_id] = hs_id
                    cur.execute("UPDATE accounts SET hubspot_company_id = %s, hubspot_last_sync = NOW() WHERE id = %s",
                                (hs_id, xo_id))
                    accounts_pushed += 1
            except Exception as e:
                logger.warning("Batch create accounts failed: %s", e)
                # Fallback to individual creates
                for c in account_creates:
                    try:
                        hs_id = _push_company(access_token, dict(zip(account_cols, [c['_xo_id']] + [None]*7)), 'partner')
                        account_hs_map[c['_xo_id']] = hs_id
                        cur.execute("UPDATE accounts SET hubspot_company_id = %s, hubspot_last_sync = NOW() WHERE id = %s",
                                    (hs_id, c['_xo_id']))
                        accounts_pushed += 1
                    except Exception as e2:
                        logger.warning("Failed to push account %s: %s", c['_xo_id'], e2)

        # Batch update accounts
        if account_updates:
            try:
                batch_body = {'inputs': [{'id': u['id'], 'properties': u['properties']} for u in account_updates]}
                _hubspot_api('POST', '/crm/v3/objects/companies/batch/update', access_token, json_body=batch_body)
                api_calls['after'] += 1
                for u in account_updates:
                    account_hs_map[u['_xo_id']] = u['id']
                    cur.execute("UPDATE accounts SET hubspot_last_sync = NOW() WHERE id = %s", (u['_xo_id'],))
                    accounts_pushed += 1
            except Exception as e:
                logger.warning("Batch update accounts failed: %s", e)

        # Push clients — only those changed since last sync
        cur.execute("""
            SELECT id, company_name, website_url, industry, description,
                   future_plans, status, source, nda_signed, nda_signed_at,
                   intellagentic_lead, pain_points_json, contacts_json,
                   addresses_json, s3_folder, hubspot_company_id,
                   hubspot_contact_id, account_id, encryption_key, company_linkedin
            FROM clients
            WHERE (status != 'deleted' OR status IS NULL)
              AND (hubspot_last_sync IS NULL OR updated_at > hubspot_last_sync)
        """)
        client_rows = cur.fetchall()
        client_cols = ['id', 'company_name', 'website_url', 'industry', 'description',
                       'future_plans', 'status', 'source', 'nda_signed', 'nda_signed_at',
                       'intellagentic_lead', 'pain_points_json', 'contacts_json',
                       'addresses_json', 's3_folder', 'hubspot_company_id',
                       'hubspot_contact_id', 'account_id', 'encryption_key', 'company_linkedin']
        clients_pushed = 0

        # Separate creates vs updates for batch
        client_creates = []
        client_updates = []
        client_records = {}  # xo_id -> record

        for row in client_rows:
            record = dict(zip(client_cols, row))
            client_key = unwrap_client_key(record.get('encryption_key')) if record.get('encryption_key') else None
            record['_client_key'] = client_key
            client_records[str(record['id'])] = record
            props = _build_company_properties(record, 'client', client_key)

            if record.get('hubspot_company_id'):
                client_updates.append({'id': record['hubspot_company_id'], 'properties': props, '_xo_id': str(record['id'])})
            else:
                client_creates.append({'properties': props, '_xo_id': str(record['id'])})

        api_calls['before'] = len(client_creates) + len(client_updates) + len(account_creates) + len(account_updates)

        # Batch create clients (max 100 per batch)
        for batch_start in range(0, len(client_creates), 100):
            batch = client_creates[batch_start:batch_start + 100]
            try:
                batch_body = {'inputs': [{'properties': c['properties']} for c in batch]}
                resp = _hubspot_api('POST', '/crm/v3/objects/companies/batch/create', access_token, json_body=batch_body)
                api_calls['after'] += 1
                for i, result in enumerate(resp.get('results', [])):
                    hs_id = result['id']
                    xo_id = batch[i]['_xo_id']
                    record = client_records[xo_id]
                    record['hubspot_company_id'] = hs_id
                    cur.execute("UPDATE clients SET hubspot_company_id = %s, hubspot_last_sync = NOW() WHERE id = %s",
                                (hs_id, xo_id))
                    clients_pushed += 1
                    logger.info("Batch created company %s (%s)", hs_id, batch[i]['properties'].get('name', ''))
            except Exception as e:
                logger.warning("Batch create clients failed, falling back to individual: %s", e)
                for c in batch:
                    try:
                        record = client_records[c['_xo_id']]
                        hs_id = _push_company(access_token, record, 'client', record.get('_client_key'))
                        record['hubspot_company_id'] = hs_id
                        cur.execute("UPDATE clients SET hubspot_company_id = %s, hubspot_last_sync = NOW() WHERE id = %s",
                                    (hs_id, c['_xo_id']))
                        clients_pushed += 1
                    except Exception as e2:
                        logger.warning("Failed to push client %s: %s", c['_xo_id'], e2)

        # Batch update clients
        for batch_start in range(0, len(client_updates), 100):
            batch = client_updates[batch_start:batch_start + 100]
            try:
                batch_body = {'inputs': [{'id': u['id'], 'properties': u['properties']} for u in batch]}
                _hubspot_api('POST', '/crm/v3/objects/companies/batch/update', access_token, json_body=batch_body)
                api_calls['after'] += 1
                for u in batch:
                    cur.execute("UPDATE clients SET hubspot_last_sync = NOW() WHERE id = %s", (u['_xo_id'],))
                    clients_pushed += 1
                    logger.info("Batch updated company %s (%s)", u['id'], u['properties'].get('name', ''))
            except Exception as e:
                logger.warning("Batch update clients failed, falling back to individual: %s", e)
                for u in batch:
                    try:
                        record = client_records[u['_xo_id']]
                        _push_company(access_token, record, 'client', record.get('_client_key'))
                        cur.execute("UPDATE clients SET hubspot_last_sync = NOW() WHERE id = %s", (u['_xo_id'],))
                        clients_pushed += 1
                    except Exception as e2:
                        logger.warning("Failed to push client %s: %s", u['_xo_id'], e2)

        # Push contacts + associations only for changed clients
        for xo_id, record in client_records.items():
            hs_company_id = record.get('hubspot_company_id')
            if not hs_company_id:
                continue
            try:
                client_key = record.get('_client_key')
                hs_contact_id = _push_contacts(access_token, record, hs_company_id, client_key)
                if hs_contact_id:
                    cur.execute("UPDATE clients SET hubspot_contact_id = %s WHERE id = %s AND hubspot_contact_id IS NULL",
                                (hs_contact_id, xo_id))

                # Account-client association
                account_id = record.get('account_id')
                if account_id and account_id in account_hs_map:
                    _create_company_association(access_token, account_hs_map[account_id], hs_company_id)
                elif intellagentic_company_id:
                    _create_company_association(access_token, intellagentic_company_id, hs_company_id)
            except Exception as e:
                logger.warning("Failed to push contacts/associations for %s: %s", xo_id, e)

        # Push approved engagement results as notes (all clients, not just changed ones)
        engagements_synced = 0
        cur.execute("SELECT id, company_name, hubspot_company_id, encryption_key FROM clients WHERE hubspot_company_id IS NOT NULL")
        all_clients_for_eng = cur.fetchall()
        for c_row in all_clients_for_eng:
            try:
                c_key = unwrap_client_key(c_row[3]) if c_row[3] else None
                engagements_synced += _push_engagement_results_for_client(access_token, cur, conn, str(c_row[0]), c_row[1] or '', c_row[2], c_key)
            except Exception as e:
                logger.warning("Failed to push engagement results for client %s: %s", c_row[1], e)

        conn.commit()
        cur.close()

        logger.info("Push complete: %s accounts, %s clients, %s engagement notes. API calls: %s individual -> %s batch",
                     accounts_pushed, clients_pushed, engagements_synced, api_calls['before'], api_calls['after'])

        # ── Phase 2: Pull HubSpot -> XO ──
        clients_created, clients_updated, client_conflicts = _pull_companies(access_token, conn, 'client')
        accounts_created, accounts_updated, _account_conflicts = _pull_companies(access_token, conn, 'partner')

        all_conflicts = client_conflicts + _account_conflicts

        # Update last sync timestamp
        _set_config(conn, 'hubspot_last_full_sync', datetime.now(timezone.utc).isoformat())

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({
                'status': 'complete',
                'pushed': {
                    'accounts': accounts_pushed,
                    'clients': clients_pushed,
                    'engagements_synced': engagements_synced,
                },
                'pulled': {
                    'clients_created': clients_created,
                    'clients_updated': clients_updated,
                    'accounts_created': accounts_created,
                    'accounts_updated': accounts_updated,
                },
                'conflicts': all_conflicts,
                'optimization': {
                    'records_skipped': 'unchanged since last sync',
                    'company_api_calls': f"{api_calls['before']} individual -> {api_calls['after']} batch",
                },
                'last_sync': datetime.now(timezone.utc).isoformat(),
            })
        }
    except Exception as e:
        logger.error("Full sync failed: %s", e)
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': f'Sync failed: {str(e)}'})
        }
    finally:
        conn.close()


def handle_sync_push(event, user):
    """POST /hubspot/sync/push — Push a specific client to HubSpot."""
    conn = get_db_connection()
    try:
        body = json.loads(event.get('body', '{}'))
        client_id = body.get('client_id', '').strip()

        if not client_id:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'client_id is required'})
            }

        access_token = _get_access_token()
        if not access_token:
            return {
                'statusCode': 401,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'HubSpot not connected'})
            }

        # PR 3.4b: share-aware write access. account_admin in a recipient
        # account with read_write share can push their view of the client.
        if not can_user_access_client(conn, user, client_id, write=True):
            return {
                'statusCode': 403,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Client not accessible or share is read-only'}),
            }

        cur = conn.cursor()
        cur.execute("""
            SELECT id, company_name, website_url, industry, description,
                   future_plans, status, source, nda_signed, nda_signed_at,
                   intellagentic_lead, pain_points_json, contacts_json,
                   addresses_json, s3_folder, hubspot_company_id,
                   hubspot_contact_id, account_id, encryption_key, company_linkedin
            FROM clients WHERE id = %s
        """, (client_id,))
        row = cur.fetchone()

        if not row:
            cur.close()
            return {
                'statusCode': 404,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Client not found'})
            }

        cols = ['id', 'company_name', 'website_url', 'industry', 'description',
                'future_plans', 'status', 'source', 'nda_signed', 'nda_signed_at',
                'intellagentic_lead', 'pain_points_json', 'contacts_json',
                'addresses_json', 's3_folder', 'hubspot_company_id',
                'hubspot_contact_id', 'account_id', 'encryption_key', 'company_linkedin']
        record = dict(zip(cols, row))
        client_key = unwrap_client_key(record.get('encryption_key')) if record.get('encryption_key') else None

        hs_company_id = _push_company(access_token, record, 'client', client_key)
        hs_contact_id = _push_contacts(access_token, record, hs_company_id, client_key)

        cur.execute("""
            UPDATE clients SET
                hubspot_company_id = %s,
                hubspot_contact_id = COALESCE(%s, hubspot_contact_id),
                hubspot_last_sync = NOW()
            WHERE id = %s
        """, (hs_company_id, hs_contact_id, client_id))
        conn.commit()

        # Handle account association
        intellagentic_company_id = _get_config(conn, 'hubspot_intellagentic_company_id')
        account_id = record.get('account_id')
        if account_id:
            cur2 = conn.cursor()
            cur2.execute("SELECT hubspot_company_id FROM accounts WHERE id = %s", (account_id,))
            prow = cur2.fetchone()
            cur2.close()
            if prow and prow[0]:
                _create_company_association(access_token, prow[0], hs_company_id)
        elif intellagentic_company_id:
            _create_company_association(access_token, intellagentic_company_id, hs_company_id)

        # Push enrichment note
        _push_enrichment_note(access_token, hs_company_id, record, client_key)

        # Push approved engagement results as notes
        db_client_id = record.get('id')
        client_name = record.get('company_name', '')
        engagements_synced = _push_engagement_results_for_client(access_token, cur, conn, db_client_id, client_name, hs_company_id, client_key)

        cur.close()
        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({
                'status': 'pushed',
                'hubspot_company_id': hs_company_id,
                'hubspot_contact_id': hs_contact_id,
                'engagements_synced': engagements_synced,
            })
        }
    except Exception as e:
        logger.error("Push sync failed: %s", e)
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': f'Push failed: {str(e)}'})
        }
    finally:
        conn.close()


def handle_sync_pull(event, user):
    """POST /hubspot/sync/pull — Pull a specific company from HubSpot into XO."""
    conn = get_db_connection()
    try:
        body = json.loads(event.get('body', '{}'))
        hubspot_company_id = body.get('hubspot_company_id', '').strip()

        if not hubspot_company_id:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'hubspot_company_id is required'})
            }

        access_token = _get_access_token()
        if not access_token:
            return {
                'statusCode': 401,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'HubSpot not connected'})
            }

        # Fetch company from HubSpot
        company = _hubspot_api('GET', f'/crm/v3/objects/companies/{hubspot_company_id}', access_token,
                               params={'properties': 'name,website,description,xo_industry,'
                                                      'xo_client_id,xo_record_type,xo_status,xo_source,'
                                                      'xo_nda_signed,xo_nda_signed_at,xo_intellagentic_lead,'
                                                      'xo_future_plans,xo_pain_points_json,xo_addresses_json,xo_sync_enabled,'
                                                      'address,address2,city,state,zip,country'})
        props = company.get('properties', {})
        record_type = props.get('xo_record_type', 'client')
        xo_id = props.get('xo_client_id')

        cur = conn.cursor()
        if record_type == 'partner':
            _pull_account_record(cur, conn, hubspot_company_id, xo_id, props)
        else:
            _pull_client_record(cur, conn, hubspot_company_id, xo_id, props)
        conn.commit()

        # Pull associated contacts
        if record_type == 'client':
            # Find the XO client ID (might have just been created)
            if not xo_id:
                cur.execute("SELECT id FROM clients WHERE hubspot_company_id = %s", (hubspot_company_id,))
                row = cur.fetchone()
                xo_id = str(row[0]) if row else None
            if xo_id:
                _pull_contacts_for_company(access_token, conn, hubspot_company_id, xo_id)

        cur.close()
        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({
                'status': 'pulled',
                'record_type': record_type,
                'hubspot_company_id': hubspot_company_id,
                'xo_id': xo_id,
            })
        }
    except requests.exceptions.HTTPError as e:
        status = e.response.status_code if e.response else 500
        logger.error("HubSpot API error during pull: %s", e)
        return {
            'statusCode': status,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': f'HubSpot API error: {str(e)}'})
        }
    except Exception as e:
        logger.error("Pull sync failed: %s", e)
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': f'Pull failed: {str(e)}'})
        }
    finally:
        conn.close()


def handle_conflicts(event, user):
    """GET /hubspot/conflicts — Return unresolved conflicts from sync log."""
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT id, record_type, record_id, hubspot_id, fields_skipped, details, synced_at
            FROM hubspot_sync_log
            WHERE sync_direction = 'conflict'
            ORDER BY synced_at DESC
            LIMIT 100
        """)
        rows = cur.fetchall()
        cur.close()

        conflicts = []
        for row in rows:
            conflicts.append({
                'log_id': row[0],
                'record_type': row[1],
                'record_id': str(row[2]) if row[2] else None,
                'hubspot_id': row[3],
                'conflicting_fields': json.loads(row[4]) if row[4] else [],
                'details': row[5],
                'synced_at': row[6].isoformat() if row[6] else None,
            })

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'conflicts': conflicts})
        }
    finally:
        conn.close()


def handle_resolve_conflict(event, user):
    """POST /hubspot/conflicts/resolve — Resolve a conflict by choosing XO or HubSpot as winner."""
    conn = get_db_connection()
    try:
        body = json.loads(event.get('body', '{}'))
        record_id = body.get('record_id', '').strip()
        winner = body.get('winner', '').strip().lower()

        if not record_id or winner not in ('xo', 'hubspot'):
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'record_id and winner (xo|hubspot) are required'})
            }

        cur = conn.cursor()

        # Look up the conflict log entry
        cur.execute("""
            SELECT id, record_type, hubspot_id, fields_skipped, details
            FROM hubspot_sync_log
            WHERE sync_direction = 'conflict' AND record_id = %s
            ORDER BY synced_at DESC LIMIT 1
        """, (record_id,))
        log_row = cur.fetchone()
        if not log_row:
            cur.close()
            return {
                'statusCode': 404,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'No conflict found for this record'})
            }

        log_id, record_type, hubspot_id, fields_skipped_json, details = log_row
        conflicting_fields = json.loads(fields_skipped_json) if fields_skipped_json else []

        if winner == 'hubspot':
            # Fetch fresh HubSpot data and apply to XO
            access_token = _get_access_token()
            if not access_token:
                cur.close()
                return {
                    'statusCode': 401,
                    'headers': CORS_HEADERS,
                    'body': json.dumps({'error': 'HubSpot not connected'})
                }

            company = _hubspot_api('GET', f'/crm/v3/objects/companies/{hubspot_id}', access_token,
                                   params={'properties': 'name,website,description,xo_industry,'
                                                          'xo_client_id,xo_record_type,xo_status,xo_source,'
                                                          'xo_nda_signed,xo_nda_signed_at,xo_intellagentic_lead,'
                                                          'xo_future_plans,xo_pain_points_json,xo_addresses_json'})
            props = company.get('properties', {})
            updated = _apply_hs_to_xo_update(cur, hubspot_id, record_id, props, 'id = %s', (record_id,))

            _log_sync(conn, record_type, record_id, hubspot_id, 'pull',
                      fields_updated=updated,
                      details=f"Conflict resolved: HubSpot wins for fields {conflicting_fields}")

        elif winner == 'xo':
            # Push XO values to HubSpot
            access_token = _get_access_token()
            if not access_token:
                cur.close()
                return {
                    'statusCode': 401,
                    'headers': CORS_HEADERS,
                    'body': json.dumps({'error': 'HubSpot not connected'})
                }

            cur.execute("""
                SELECT id, company_name, website_url, industry, description,
                       future_plans, status, source, nda_signed, nda_signed_at,
                       intellagentic_lead, pain_points_json, contacts_json,
                       addresses_json, s3_folder, hubspot_company_id,
                       hubspot_contact_id, account_id, encryption_key, company_linkedin
                FROM clients WHERE id = %s
            """, (record_id,))
            row = cur.fetchone()
            if row:
                cols = ['id', 'company_name', 'website_url', 'industry', 'description',
                        'future_plans', 'status', 'source', 'nda_signed', 'nda_signed_at',
                        'intellagentic_lead', 'pain_points_json', 'contacts_json',
                        'addresses_json', 's3_folder', 'hubspot_company_id',
                        'hubspot_contact_id', 'account_id', 'encryption_key', 'company_linkedin']
                record = dict(zip(cols, row))
                client_key = unwrap_client_key(record.get('encryption_key')) if record.get('encryption_key') else None
                _push_company(access_token, record, record_type, client_key)

            cur.execute("UPDATE clients SET hubspot_last_sync = NOW() WHERE id = %s", (record_id,))

            _log_sync(conn, record_type, record_id, hubspot_id, 'push',
                      fields_updated=conflicting_fields,
                      details=f"Conflict resolved: XO wins for fields {conflicting_fields}")

        # Remove the conflict log entry
        cur.execute("DELETE FROM hubspot_sync_log WHERE id = %s", (log_id,))
        conn.commit()
        cur.close()

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({
                'status': 'resolved',
                'winner': winner,
                'record_id': record_id,
                'fields': conflicting_fields,
            })
        }
    except Exception as e:
        logger.error("Conflict resolution failed: %s", e)
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': f'Resolution failed: {str(e)}'})
        }
    finally:
        conn.close()


def handle_webhook(event):
    """POST /hubspot/webhook — Pull-only sync triggered by external webhook.
    Authenticated via ?secret= query parameter, not JWT."""
    query = event.get('queryStringParameters') or {}
    secret = query.get('secret', '')

    if not HUBSPOT_WEBHOOK_SECRET or secret != HUBSPOT_WEBHOOK_SECRET:
        return {
            'statusCode': 401,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Invalid or missing webhook secret'})
        }

    access_token = _get_access_token()
    if not access_token:
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'HUBSPOT_PRIVATE_TOKEN not configured'})
        }

    conn = get_db_connection()
    try:
        _ensure_custom_properties(access_token)

        clients_created, clients_updated, conflicts = _pull_companies(access_token, conn, 'client')
        accounts_created, accounts_updated, _ = _pull_companies(access_token, conn, 'partner')

        _set_config(conn, 'hubspot_last_full_sync', datetime.now(timezone.utc).isoformat())

        logger.info("Webhook pull sync complete: clients=%s new + %s updated, accounts=%s new + %s updated",
                     clients_created, clients_updated, accounts_created, accounts_updated)

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({
                'status': 'complete',
                'mode': 'pull_only',
                'pulled': {
                    'clients_created': clients_created,
                    'clients_updated': clients_updated,
                    'accounts_created': accounts_created,
                    'accounts_updated': accounts_updated,
                },
                'conflicts': conflicts,
            })
        }
    except Exception as e:
        logger.error("Webhook pull sync failed: %s", e)
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': f'Webhook sync failed: {str(e)}'})
        }
    finally:
        conn.close()


def handle_mapping(event, user):
    """GET /hubspot/mapping — Return current field mapping configuration."""
    mapping = {
        'client_to_company': {
            'company_name': 'name (HubSpot Company name)',
            'website_url': 'website (HubSpot Company website)',
            'industry': 'xo_industry (custom text, free-form)',
            'description': 'description (HubSpot Company description)',
            'future_plans': 'xo_future_plans (custom text)',
            'status': 'xo_status (custom)',
            'source': 'xo_source (custom)',
            'nda_signed': 'xo_nda_signed (custom boolean)',
            'nda_signed_at': 'xo_nda_signed_at (custom datetime)',
            'intellagentic_lead': 'xo_intellagentic_lead (custom boolean)',
            'pain_points_json': 'xo_pain_points_json (custom text, JSON array)',
            'contacts_json': 'Multiple HubSpot Contacts associated to Company (name, email, phone, title, linkedin)',
            'addresses_json': 'xo_addresses_json (custom text, JSON array) + HubSpot standard address from first entry',
            'account_id': 'Company-to-Company association with Partner HubSpot Company',
        },
        'custom_properties': {
            'xo_record_type': 'partner | client',
            'xo_client_id': 'XO Capture UUID back-reference',
            'xo_status': 'Client status in XO',
            'xo_source': 'Client source (e.g. invite, manual)',
            'xo_nda_signed': 'Boolean - NDA signed status',
            'xo_nda_signed_at': 'Datetime - when NDA was signed',
            'xo_intellagentic_lead': 'Boolean - Intellagentic lead flag',
            'xo_future_plans': 'Text - client future plans',
            'xo_pain_points_json': 'Text - JSON array of pain points',
            'xo_addresses_json': 'Text - JSON array of addresses',
            'xo_sync_enabled': 'Boolean - set true on HubSpot company to pull into XO Capture',
        },
        'associations': {
            'contact_to_company': 'All contacts from contacts_json linked to Company',
            'company_to_company': 'Partner Company -> Client Company (Channel Partner)',
            'note_to_company': 'Enrichment summary notes on Company',
        },
        'dedup_strategy': {
            'primary': 'Match on website/domain (normalized, case-insensitive)',
            'fallback': 'Match on company name (fuzzy/contains)',
            'tracking': 'hubspot_company_id stored in clients/accounts table',
        },
        'pull_behavior': {
            'existing_records': 'Companies pushed from XO (have xo_client_id) sync normally regardless of xo_sync_enabled',
            'new_records': 'Only HubSpot companies with xo_sync_enabled=true are pulled into XO Capture as new clients',
            'how_to_enable': 'Set "Sync to XO Capture" checkbox to true on the HubSpot Company record',
        },
    }

    return {
        'statusCode': 200,
        'headers': CORS_HEADERS,
        'body': json.dumps(mapping)
    }


# ── Lambda Handler (router) ──

def lambda_handler(event, context):
    """
    Method router for /hubspot/* endpoints.
    """

    # Handle OPTIONS preflight
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    path = event.get('path', '')
    method = event.get('httpMethod', '')

    # OAuth callback — no auth required (HubSpot redirects here)
    if '/hubspot/callback' in path and method == 'GET':
        response = handle_callback(event)
        log_activity(event, response)
        return response

    # Webhook — no JWT auth, uses ?secret= parameter
    if '/hubspot/webhook' in path and method == 'POST':
        response = handle_webhook(event)
        log_activity(event, response)
        return response

    # All other routes require auth
    user, err = require_auth(event)
    if err:
        log_activity(event, err)
        return err

    response = _route_hubspot(event, user, path, method)
    log_activity(event, response, user)
    return response


def _route_hubspot(event, user, path, method):
    """Route authenticated HubSpot requests."""

    if '/hubspot/connect' in path and method == 'POST':
        return handle_connect(event, user)

    if '/hubspot/status' in path and method == 'GET':
        return handle_status(event, user)

    if '/hubspot/conflicts/resolve' in path and method == 'POST':
        return handle_resolve_conflict(event, user)

    if '/hubspot/conflicts' in path and method == 'GET':
        return handle_conflicts(event, user)

    if '/hubspot/sync/push' in path and method == 'POST':
        return handle_sync_push(event, user)

    if '/hubspot/sync/pull' in path and method == 'POST':
        return handle_sync_pull(event, user)

    if '/hubspot/sync' in path and method == 'POST':
        return handle_sync(event, user)

    if '/hubspot/mapping' in path and method == 'GET':
        return handle_mapping(event, user)

    return {
        'statusCode': 404,
        'headers': CORS_HEADERS,
        'body': json.dumps({'error': f'Not found: {method} {path}'})
    }
