"""
XO Platform — Bidirectional SF push (XO client → SF Account).

This module owns the *outbound* lifecycle push that runs when a client is
created, updated, or soft-deleted in XO Capture. It is distinct from the
older `handle_sync_push` engagement path (which posts a Task on a parent
Account) — that path lives in lambda_function.py and continues to fire on
engagement summary generation.

Matching policy (see PR brief "Salesforce bi-directional sync"):
  - existing link in client_salesforce_links → PATCH that Account.
  - else, domain match against SF Account.Website (skip generic email
    providers): 1 hit auto-links + PATCH; 2+ hits flag for manual review.
  - else, exact name match against SF Account.Name: any hit flags for
    manual review (name alone is too weak to auto-link on).
  - else, POST a new Account and write the link row.

The "[Synced from XO Capture]" Description prefix is applied only when
this module creates a brand-new SF Account. Adoption via domain match
and all subsequent updates do not re-add it.

Status surface (clients.salesforce_push_status):
  pending               — set by the write-path before the push runs.
  pushed                — last attempt succeeded.
  failed                — last attempt errored; error in salesforce_push_error.
  awaiting_manual_link  — push paused for user resolution; candidate SF
                          accounts in salesforce_match_candidates JSONB.
"""

import json
import logging
import re
from datetime import datetime, timezone

from sf_client import soql_escape, sf_call_with_refresh

logger = logging.getLogger('xo.salesforce.push')
logger.setLevel(logging.INFO)


# ──────────────────────────────────────────────
# Domain helpers
# ──────────────────────────────────────────────

# Email providers we never derive an Account.Website match from — every
# tenant has employees with gmail addresses, so a domain match on these
# would link unrelated companies together.
GENERIC_EMAIL_DOMAINS = frozenset({
    'gmail.com', 'googlemail.com',
    'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
    'yahoo.com', 'yahoo.co.uk', 'ymail.com',
    'icloud.com', 'me.com', 'mac.com',
    'aol.com', 'protonmail.com', 'proton.me',
    'fastmail.com', 'gmx.com', 'zoho.com',
})

_EMAIL_RE = re.compile(r'^[^@\s]+@([^@\s]+)$')


def _domain_from_email(email):
    """Lowercase host part of an email, or None if invalid/generic provider."""
    if not email:
        return None
    m = _EMAIL_RE.match(email.strip())
    if not m:
        return None
    host = m.group(1).lower()
    if host in GENERIC_EMAIL_DOMAINS:
        return None
    return host


def _domain_from_website(website):
    """Strip scheme + path + leading www, lowercase. None if empty."""
    if not website:
        return None
    s = website.strip().lower()
    s = re.sub(r'^https?://', '', s)
    s = s.split('/', 1)[0]
    s = s.split('?', 1)[0]
    if s.startswith('www.'):
        s = s[4:]
    return s or None


def _primary_email_from_client(client):
    """Return the primary contact email (first non-empty), else None."""
    contacts = client.get('contacts') or []
    for c in contacts:
        if c.get('email'):
            return c['email']
    return client.get('contact_email') or None


def _client_domain(client):
    """Pick the best available domain: client website first, else primary
    contact email. Filters out generic email providers via _domain_from_email."""
    d = _domain_from_website(client.get('website_url'))
    if d:
        return d
    return _domain_from_email(_primary_email_from_client(client))


# ──────────────────────────────────────────────
# Client loader
# ──────────────────────────────────────────────
def load_client_for_push(conn, client_id):
    """Fetch the columns the push path needs. Returns dict or None."""
    cur = conn.cursor()
    try:
        cur.execute(
            """SELECT id, company_name, website_url, industry, description,
                      contact_email, contacts_json, addresses_json, account_id
               FROM clients WHERE id = %s""",
            (client_id,),
        )
        row = cur.fetchone()
    finally:
        cur.close()
    if not row:
        return None

    contacts = []
    if row[6]:
        try:
            contacts = json.loads(row[6]) if isinstance(row[6], str) else row[6]
        except (json.JSONDecodeError, TypeError):
            contacts = []
    addresses = []
    if row[7]:
        try:
            addresses = json.loads(row[7]) if isinstance(row[7], str) else row[7]
        except (json.JSONDecodeError, TypeError):
            addresses = []

    return {
        'id': row[0],
        'company_name': row[1] or '',
        'website_url': row[2] or '',
        'industry': row[3] or '',
        'description': row[4] or '',
        'contact_email': row[5] or '',
        'contacts': contacts or [],
        'addresses': addresses or [],
        'account_id': row[8],
    }


# ──────────────────────────────────────────────
# Field mapping XO client → SF Account
# ──────────────────────────────────────────────
SYNCED_PREFIX = '[Synced from XO Capture]'
INACTIVE_PREFIX = '[XO-INACTIVE]'


def _build_account_props(client, is_initial_create):
    """Build SF Account property dict. Standard fields only.

    `is_initial_create` controls whether to prefix Description with the
    SYNCED_PREFIX marker — applied only when we are creating a new SF
    Account, never on adoption-via-match or subsequent updates.
    """
    props = {'Name': client['company_name']}

    # Website: prefer explicit website field, else derive from contact email.
    website_domain = _domain_from_website(client.get('website_url'))
    if website_domain:
        props['Website'] = website_domain[:255]
    else:
        email_domain = _domain_from_email(_primary_email_from_client(client))
        if email_domain:
            props['Website'] = email_domain[:255]

    if client.get('industry'):
        props['Industry'] = client['industry'][:40]

    description = client.get('description') or ''
    if is_initial_create:
        description = f"{SYNCED_PREFIX}\n\n{description}".rstrip()
    if description:
        props['Description'] = description[:32000]

    # Primary address → Billing*.
    addrs = client.get('addresses') or []
    primary = addrs[0] if addrs else None
    if primary:
        street_parts = [primary.get('address1'), primary.get('address2')]
        street = '\n'.join(p for p in street_parts if p)
        if street:
            props['BillingStreet'] = street[:255]
        if primary.get('city'):
            props['BillingCity'] = primary['city'][:40]
        if primary.get('state'):
            props['BillingState'] = primary['state'][:80]
        if primary.get('postalCode'):
            props['BillingPostalCode'] = primary['postalCode'][:20]
        if primary.get('country'):
            props['BillingCountry'] = primary['country'][:80]

    return props


# ──────────────────────────────────────────────
# Active__c custom field probe (cached per account)
# ──────────────────────────────────────────────
def _read_has_active_field(conn, account_id):
    """Return cached probe result: True / False / None (never probed)."""
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT salesforce_has_active_field FROM accounts WHERE id = %s",
            (account_id,),
        )
        row = cur.fetchone()
    finally:
        cur.close()
    if not row:
        return None
    return row[0]


def _write_has_active_field(conn, account_id, has_field):
    cur = conn.cursor()
    try:
        cur.execute(
            "UPDATE accounts SET salesforce_has_active_field = %s WHERE id = %s",
            (has_field, account_id),
        )
        conn.commit()
    finally:
        cur.close()


def probe_active_field(conn, account_id, tokens):
    """Returns bool. Probes /sobjects/Account/describe/ on first call and
    caches the boolean on accounts.salesforce_has_active_field.

    Errors during probe are treated as 'no Active__c' (False) — pessimistic
    so the inactive path falls back to the Description prefix, which works
    on every org regardless of custom fields."""
    cached = _read_has_active_field(conn, account_id)
    if cached is not None:
        return bool(cached)
    try:
        status, body = sf_call_with_refresh(
            conn, account_id, tokens, 'GET', '/sobjects/Account/describe/'
        )
        has_field = False
        if status == 200:
            for f in body.get('fields') or []:
                if f.get('name') == 'Active__c':
                    has_field = True
                    break
    except Exception as e:
        logger.warning("Active__c probe failed for account %s: %s", account_id, e)
        has_field = False
    _write_has_active_field(conn, account_id, has_field)
    return has_field


# ──────────────────────────────────────────────
# Status writers
# ──────────────────────────────────────────────
def _set_status(conn, client_id, status, error=None, candidates=None):
    """Persist push status + optional error + optional candidate list."""
    cur = conn.cursor()
    try:
        cur.execute(
            """UPDATE clients
                  SET salesforce_push_status = %s,
                      salesforce_push_error = %s,
                      salesforce_push_last_attempt = NOW(),
                      salesforce_match_candidates = %s
                WHERE id = %s""",
            (
                status,
                error,
                json.dumps(candidates) if candidates is not None else None,
                client_id,
            ),
        )
        conn.commit()
    finally:
        cur.close()


def _upsert_link(conn, client_id, account_id, sf_account_id):
    cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO client_salesforce_links
                   (client_id, account_id, salesforce_account_id, salesforce_last_sync)
               VALUES (%s, %s, %s, NOW())
               ON CONFLICT (client_id, account_id) DO UPDATE
                   SET salesforce_account_id = EXCLUDED.salesforce_account_id,
                       salesforce_last_sync = EXCLUDED.salesforce_last_sync""",
            (client_id, account_id, sf_account_id),
        )
        conn.commit()
    finally:
        cur.close()


def get_existing_link(conn, client_id, account_id):
    """Return the SF Account Id this client is already linked to for this
    actor account, or None if no link yet."""
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT salesforce_account_id FROM client_salesforce_links "
            "WHERE client_id = %s AND account_id = %s",
            (client_id, account_id),
        )
        row = cur.fetchone()
    finally:
        cur.close()
    return row[0] if row and row[0] else None


# ──────────────────────────────────────────────
# Match logic
# ──────────────────────────────────────────────
def _query_accounts(conn, account_id, tokens, where_clause, limit=10):
    """Run a SOQL Account query. Returns list of dicts {Id, Name, Website}."""
    q = (f"SELECT Id, Name, Website FROM Account "
         f"WHERE {where_clause} LIMIT {limit}")
    status, body = sf_call_with_refresh(
        conn, account_id, tokens, 'GET', '/query/', params={'q': q}
    )
    if status != 200:
        logger.warning("SF query failed: status=%s body=%s where=%s",
                       status, body, where_clause)
        return []
    return [
        {'sf_id': r['Id'], 'name': r.get('Name') or '', 'website': r.get('Website') or ''}
        for r in (body.get('records') or [])
    ]


def match_sf_account(conn, account_id, tokens, client):
    """Decide what to do with this client.

    Returns a tuple (decision, payload) where decision is one of:
      'link'           — adopt the single matched Account. payload = sf_id (str).
      'flag_candidates'— flag for manual review. payload = list of candidate dicts.
      'create_new'     — no match. payload = None.
    """
    # 1. Domain match against Website.
    domain = _client_domain(client)
    if domain:
        escaped = soql_escape(domain)
        # SOQL doesn't support ILIKE; LIKE with % wildcards is case-insensitive
        # on standard text fields. Wildcards both sides handle www. / https://
        # variants stored in Website.
        candidates = _query_accounts(
            conn, account_id, tokens,
            f"Website LIKE '%{escaped}%'",
        )
        if len(candidates) == 1:
            return 'link', candidates[0]['sf_id']
        if len(candidates) > 1:
            return 'flag_candidates', candidates

    # 2. Exact name match — flag-only, never auto-link (per brief: name
    # alone is too weak a signal to assume identity).
    name = client.get('company_name')
    if name:
        candidates = _query_accounts(
            conn, account_id, tokens,
            f"Name = '{soql_escape(name)}'",
        )
        if candidates:
            return 'flag_candidates', candidates

    # 3. No match — create new.
    return 'create_new', None


# ──────────────────────────────────────────────
# SF Account operations
# ──────────────────────────────────────────────
def _create_account(conn, account_id, tokens, client):
    """POST a new SF Account. is_initial_create=True so prefix is applied."""
    props = _build_account_props(client, is_initial_create=True)
    status, body = sf_call_with_refresh(
        conn, account_id, tokens, 'POST', '/sobjects/Account/', json_body=props,
    )
    if status in (200, 201) and body.get('id'):
        return body['id']
    raise RuntimeError(f"SF Account POST failed: status={status} body={body}")


def _patch_account(conn, account_id, tokens, sf_id, client):
    """PATCH an existing SF Account. is_initial_create=False (no prefix)."""
    props = _build_account_props(client, is_initial_create=False)
    status, body = sf_call_with_refresh(
        conn, account_id, tokens, 'PATCH',
        f'/sobjects/Account/{sf_id}', json_body=props,
    )
    if status not in (200, 204):
        raise RuntimeError(f"SF Account PATCH failed: status={status} body={body}")


def _mark_account_inactive(conn, account_id, tokens, sf_id, client):
    """Soft-delete equivalent on SF side.

    Prefers Active__c=false (custom field, if the org has it). Falls back
    to prefixing Description with INACTIVE_PREFIX and setting Type='Other'.
    Never deletes the SF Account."""
    has_active = probe_active_field(conn, account_id, tokens)
    if has_active:
        props = {'Active__c': False}
    else:
        desc = client.get('description') or ''
        if not desc.startswith(INACTIVE_PREFIX):
            desc = f"{INACTIVE_PREFIX} {desc}".rstrip()
        props = {'Description': desc[:32000], 'Type': 'Other'}

    status, body = sf_call_with_refresh(
        conn, account_id, tokens, 'PATCH',
        f'/sobjects/Account/{sf_id}', json_body=props,
    )
    if status not in (200, 204):
        raise RuntimeError(f"SF Account inactive PATCH failed: "
                           f"status={status} body={body}")


# ──────────────────────────────────────────────
# Main push entrypoint
# ──────────────────────────────────────────────
def push_client(conn, account_id, tokens, client_id, change_type):
    """Push a single client to SF following the bidi matching policy.

    Returns dict describing the outcome:
      {'status': 'pushed', 'sf_id': '...', 'created': bool}
      {'status': 'awaiting_manual_link', 'candidates': [...]}
      {'status': 'failed', 'error': '...'}
      {'status': 'skipped', 'reason': '...'}

    change_type: 'create' | 'update' | 'delete' (informational; the actual
    SF call is selected by whether the client has an existing link).
    """
    client = load_client_for_push(conn, client_id)
    if not client:
        return {'status': 'skipped', 'reason': f'client {client_id} not found'}
    if not client.get('company_name'):
        _set_status(conn, client_id, 'failed',
                    error='Client has no company_name; SF Account.Name is required')
        return {'status': 'failed', 'error': 'company_name required'}
    if not client.get('account_id'):
        return {'status': 'skipped', 'reason': 'client has no account_id'}

    existing_sf_id = get_existing_link(conn, client_id, account_id)

    # ── Delete path: only act if linked. No link = nothing to mark inactive.
    if change_type == 'delete':
        if not existing_sf_id:
            return {'status': 'skipped', 'reason': 'no SF link to mark inactive'}
        try:
            _mark_account_inactive(conn, account_id, tokens, existing_sf_id, client)
            _set_status(conn, client_id, 'pushed', candidates=None)
            return {'status': 'pushed', 'sf_id': existing_sf_id, 'created': False}
        except Exception as e:
            logger.exception("SF inactive push failed for client %s: %s", client_id, e)
            _set_status(conn, client_id, 'failed', error=str(e))
            return {'status': 'failed', 'error': str(e)}

    # ── Create / update path.
    try:
        if existing_sf_id:
            _patch_account(conn, account_id, tokens, existing_sf_id, client)
            _upsert_link(conn, client_id, account_id, existing_sf_id)
            _set_status(conn, client_id, 'pushed', candidates=None)
            return {'status': 'pushed', 'sf_id': existing_sf_id, 'created': False}

        decision, payload = match_sf_account(conn, account_id, tokens, client)
        if decision == 'link':
            _patch_account(conn, account_id, tokens, payload, client)
            _upsert_link(conn, client_id, account_id, payload)
            _set_status(conn, client_id, 'pushed', candidates=None)
            return {'status': 'pushed', 'sf_id': payload, 'created': False}
        if decision == 'flag_candidates':
            _set_status(conn, client_id, 'awaiting_manual_link',
                        candidates=payload)
            return {'status': 'awaiting_manual_link', 'candidates': payload}
        # decision == 'create_new'
        new_sf_id = _create_account(conn, account_id, tokens, client)
        _upsert_link(conn, client_id, account_id, new_sf_id)
        _set_status(conn, client_id, 'pushed', candidates=None)
        return {'status': 'pushed', 'sf_id': new_sf_id, 'created': True}
    except Exception as e:
        logger.exception("SF push failed for client %s: %s", client_id, e)
        _set_status(conn, client_id, 'failed', error=str(e))
        return {'status': 'failed', 'error': str(e)}


# ──────────────────────────────────────────────
# Resolve-match (user picks from candidates)
# ──────────────────────────────────────────────
def resolve_match(conn, account_id, tokens, client_id, action, sf_account_id=None):
    """User-driven resolution of an awaiting_manual_link client.

    action='link'       — link to a specific Account, PATCH it, mark pushed.
    action='create_new' — POST a new Account, link it, mark pushed.
    """
    client = load_client_for_push(conn, client_id)
    if not client:
        return {'status': 'failed', 'error': f'client {client_id} not found'}
    if not client.get('account_id'):
        return {'status': 'failed', 'error': 'client has no account_id'}

    try:
        if action == 'link':
            if not sf_account_id:
                return {'status': 'failed',
                        'error': 'sf_account_id required for link action'}
            _patch_account(conn, account_id, tokens, sf_account_id, client)
            _upsert_link(conn, client_id, account_id, sf_account_id)
            _set_status(conn, client_id, 'pushed', candidates=None)
            return {'status': 'pushed', 'sf_id': sf_account_id, 'created': False}

        if action == 'create_new':
            new_sf_id = _create_account(conn, account_id, tokens, client)
            _upsert_link(conn, client_id, account_id, new_sf_id)
            _set_status(conn, client_id, 'pushed', candidates=None)
            return {'status': 'pushed', 'sf_id': new_sf_id, 'created': True}

        return {'status': 'failed', 'error': f'unknown action: {action}'}
    except Exception as e:
        logger.exception("resolve_match failed for client %s: %s", client_id, e)
        _set_status(conn, client_id, 'failed', error=str(e))
        return {'status': 'failed', 'error': str(e)}


# ──────────────────────────────────────────────
# Push-all (used by Sync Now and explicit retry)
# ──────────────────────────────────────────────
def push_all_pending(conn, account_id, tokens):
    """Push every client owned by `account_id` whose push status is
    pending or failed. Skips awaiting_manual_link (those need user input)
    and pushed (already in sync)."""
    cur = conn.cursor()
    try:
        cur.execute(
            """SELECT id FROM clients
               WHERE account_id = %s
                 AND (salesforce_push_status IS NULL
                      OR salesforce_push_status IN ('pending', 'failed'))""",
            (account_id,),
        )
        ids = [row[0] for row in cur.fetchall()]
    finally:
        cur.close()

    results = {'attempted': 0, 'pushed': 0, 'failed': 0,
               'awaiting_manual_link': 0, 'skipped': 0}
    for cid in ids:
        outcome = push_client(conn, account_id, tokens, cid, 'update')
        results['attempted'] += 1
        s = outcome.get('status', 'failed')
        if s in results:
            results[s] += 1
        else:
            results['failed'] += 1
    return results
