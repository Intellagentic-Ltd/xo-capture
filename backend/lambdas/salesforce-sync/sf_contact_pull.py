"""
XO Platform — Salesforce Contact pull (PR 3.5 / Stage 1b completion).

Polls SF for Contact records changed since the last per-account
timestamp. Each SF Contact merges into the linked XO client's
contacts_json array, with email-based dedup and per-tenant scoping via
client_salesforce_links.

PER-ENTITY TIMESTAMP
  salesforce_contact_last_pull_at (account_id-scoped, integrations_config).

CONFLICT AGGREGATION
  Per-contact field diffs collect into one salesforce_sync_log row per
  client with sync_direction='conflict', fields_skipped = JSON list of
  emails, details = JSON list of {email, field, xo_value, sf_value}.
  This lets the PR 4 UI present "client X has 3 contacts in conflict"
  rather than 3 separate per-contact log rows.

LEGACY contacts_json FALLBACK
  Mirrors enrich/lambda_function.py:399. If clients.contacts_json is
  empty/null but the legacy contact_name / contact_email / contact_phone
  / contact_linkedin / contact_title columns are populated, build a
  synthetic single-element list before merging. Otherwise SF pulls into
  a client whose legacy contact survives only on those columns would
  silently lose that contact.

CALLER CONTRACT
  pull_contacts(conn, account_id, tokens) is the batch entry; called
  from handle_sync_pull. _reconcile_contact(conn, account_id, sf_contact)
  is the single-record entry; called from the Outbound Message webhook.
"""

import json
import logging
from datetime import datetime, timezone

from crypto_helper import (
    unwrap_client_key, client_decrypt_json, client_encrypt_json,
)
from integrations_config import get_account_config, set_account_config
from sf_client import sf_call_with_refresh, soql_escape
from sf_pull import (
    _describe_fields, _parse_sf_timestamp, determine_sync_direction,
)

logger = logging.getLogger('xo.salesforce.contact_pull')
logger.setLevel(logging.INFO)


SYNC_FIELDS_CONTACT = {
    # XO contact dict key → SF Contact field. Standard fields only.
    'email': 'Email',
    'firstName': 'FirstName',
    'lastName': 'LastName',
    'title': 'Title',
}


# ──────────────────────────────────────────────
# Legacy contacts_json fallback (mirrors enrich/lambda_function.py:399)
# ──────────────────────────────────────────────
def _build_contacts_from_legacy(legacy_cols: dict) -> list[dict]:
    """If the modern contacts_json is empty, salvage a single-element list
    from the legacy contact_* columns. Returns [] if nothing usable."""
    legacy = {
        'name': legacy_cols.get('contact_name') or '',
        'title': legacy_cols.get('contact_title') or '',
        'linkedin': legacy_cols.get('contact_linkedin') or '',
        'email': legacy_cols.get('contact_email') or '',
        'phone': legacy_cols.get('contact_phone') or '',
    }
    if any(legacy.values()):
        return [legacy]
    return []


def _read_xo_contacts(conn, xo_client_id):
    """Decrypt and return the client's contacts list (modern OR legacy
    fallback) plus the unwrapped per-client key for re-encryption.

    Returns (contacts_list, client_key) — contacts may be empty list."""
    cur = conn.cursor()
    try:
        cur.execute(
            """SELECT encryption_key, contacts_json,
                      contact_name, contact_email, contact_phone,
                      contact_linkedin, contact_title
               FROM clients WHERE id = %s""",
            (xo_client_id,),
        )
        row = cur.fetchone()
    finally:
        cur.close()
    if not row:
        return [], None

    enc_key, contacts_raw, c_name, c_email, c_phone, c_linkedin, c_title = row
    client_key = unwrap_client_key(enc_key) if enc_key else None

    contacts = []
    if contacts_raw:
        try:
            parsed = client_decrypt_json(client_key, contacts_raw)
            if isinstance(parsed, list):
                contacts = parsed
            elif isinstance(parsed, str):
                # Edge case: decrypt_json returned a string (not yet decoded).
                contacts = json.loads(parsed) if parsed else []
        except (json.JSONDecodeError, TypeError):
            contacts = []

    if not contacts:
        contacts = _build_contacts_from_legacy({
            'contact_name': c_name, 'contact_email': c_email,
            'contact_phone': c_phone, 'contact_linkedin': c_linkedin,
            'contact_title': c_title,
        })

    return contacts, client_key


def _write_xo_contacts(conn, xo_client_id, contacts, client_key):
    """Re-encrypt and persist the merged contacts list."""
    encrypted = client_encrypt_json(client_key, contacts) if contacts else None
    cur = conn.cursor()
    try:
        cur.execute(
            "UPDATE clients SET contacts_json = %s, updated_at = NOW() "
            "WHERE id = %s",
            (encrypted, xo_client_id),
        )
        conn.commit()
    finally:
        cur.close()


# ──────────────────────────────────────────────
# Match + merge + conflict detection
# ──────────────────────────────────────────────
def _find_existing_contact(contacts: list[dict], sf_contact: dict) -> tuple[int, dict | None]:
    """Return (index, dict) for the first matching contact, or (-1, None).
    Match priority: salesforce_contact_id, then lower(email)."""
    sf_id = sf_contact.get('Id')
    sf_email = (sf_contact.get('Email') or '').lower()
    for i, c in enumerate(contacts):
        if sf_id and c.get('salesforce_contact_id') == sf_id:
            return i, c
    for i, c in enumerate(contacts):
        existing_email = (c.get('email') or '').lower()
        if sf_email and existing_email == sf_email:
            return i, c
    return -1, None


def _build_contact_from_sf(sf_contact: dict) -> dict:
    """Project SF Contact fields into the XO contact-dict shape."""
    return {
        'email': sf_contact.get('Email') or '',
        'firstName': sf_contact.get('FirstName') or '',
        'lastName': sf_contact.get('LastName') or '',
        'name': (
            f"{sf_contact.get('FirstName') or ''} "
            f"{sf_contact.get('LastName') or ''}"
        ).strip(),
        'title': sf_contact.get('Title') or '',
        'salesforce_contact_id': sf_contact.get('Id'),
    }


def _detect_contact_conflicts(xo_contact: dict, sf_contact: dict) -> list[dict]:
    """Compare matched contacts. Return a list of per-field diffs.
    Treats None and '' as equivalent."""
    diffs = []
    pairs = [
        ('email', sf_contact.get('Email')),
        ('firstName', sf_contact.get('FirstName')),
        ('lastName', sf_contact.get('LastName')),
        ('title', sf_contact.get('Title')),
    ]
    for xo_key, sf_val in pairs:
        xo_val = xo_contact.get(xo_key)
        if (xo_val or None) != (sf_val or None):
            diffs.append({
                'email': xo_contact.get('email') or sf_contact.get('Email') or '',
                'field': xo_key,
                'xo_value': xo_val,
                'sf_value': sf_val,
            })
    return diffs


# ──────────────────────────────────────────────
# Linked-client lookup (via client_salesforce_links)
# ──────────────────────────────────────────────
def _find_linked_xo_client(conn, account_id, sf_account_id):
    """For the actor's account, look up the XO client linked to this SF
    Account. PR 3.5: reads client_salesforce_links (per-tenant)."""
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT client_id FROM client_salesforce_links "
            "WHERE account_id = %s AND salesforce_account_id = %s",
            (account_id, sf_account_id),
        )
        row = cur.fetchone()
    finally:
        cur.close()
    return row[0] if row else None


def _log_orphan(conn, account_id, sf_id, details):
    cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO salesforce_sync_log
                   (account_id, record_type, salesforce_id,
                    sync_direction, details)
               VALUES (%s, 'contact', %s, 'pull', %s)""",
            (account_id, sf_id, details),
        )
        conn.commit()
    finally:
        cur.close()


def _log_client_conflict(conn, account_id, xo_client_id,
                         conflicting_emails, per_field_diffs):
    cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO salesforce_sync_log
                   (account_id, record_type, record_id, sync_direction,
                    fields_skipped, details)
               VALUES (%s, 'client', %s, 'conflict', %s, %s)""",
            (account_id, xo_client_id,
             json.dumps(sorted(set(conflicting_emails))),
             json.dumps(per_field_diffs)),
        )
        conn.commit()
    finally:
        cur.close()


# ──────────────────────────────────────────────
# Single-record reconcile (also used by webhook)
# ──────────────────────────────────────────────
def _reconcile_contact(conn, account_id, sf_contact):
    """Merge one SF Contact into the linked XO client's contacts_json.

    Returns a tag for the run summary:
      'pulled' | 'inserted' | 'conflict' | 'orphan' | 'noop'
    """
    sf_account_id = sf_contact.get('AccountId')
    if not sf_account_id:
        _log_orphan(conn, account_id, sf_contact.get('Id'),
                    'contact orphaned, no AccountId on SF record')
        return 'orphan'

    xo_client_id = _find_linked_xo_client(conn, account_id, sf_account_id)
    if not xo_client_id:
        _log_orphan(conn, account_id, sf_contact.get('Id'),
                    'contact orphaned, no linked XO client')
        return 'orphan'

    contacts, client_key = _read_xo_contacts(conn, xo_client_id)
    if contacts is None:
        contacts = []

    idx, existing = _find_existing_contact(contacts, sf_contact)

    # Conflict detection only meaningful when both sides exist.
    if existing is not None:
        diffs = _detect_contact_conflicts(existing, sf_contact)
        if diffs:
            _log_client_conflict(
                conn, account_id, xo_client_id,
                conflicting_emails=[d['email'] for d in diffs],
                per_field_diffs=diffs,
            )
            return 'conflict'
        # No conflict — but also no diff, so a no-op apart from refreshing
        # the salesforce_contact_id link if it was missing.
        if not existing.get('salesforce_contact_id') and sf_contact.get('Id'):
            existing['salesforce_contact_id'] = sf_contact['Id']
            contacts[idx] = existing
            _write_xo_contacts(conn, xo_client_id, contacts, client_key)
            return 'pulled'
        return 'noop'

    # No match — insert.
    new_contact = _build_contact_from_sf(sf_contact)
    contacts.append(new_contact)
    _write_xo_contacts(conn, xo_client_id, contacts, client_key)
    return 'inserted'


# ──────────────────────────────────────────────
# Batch pull
# ──────────────────────────────────────────────
def _query_contacts(conn, account_id, tokens, since_iso, use_xo_filter):
    where = "WHERE Id != null"
    if use_xo_filter:
        where += " AND XO_Sync_Enabled__c = TRUE"
    if since_iso:
        where += f" AND LastModifiedDate > {since_iso}"
    q = (
        "SELECT Id, Email, FirstName, LastName, Title, AccountId, LastModifiedDate "
        f"FROM Contact {where} ORDER BY LastModifiedDate LIMIT 200"
    )
    status, body = sf_call_with_refresh(
        conn, account_id, tokens, 'GET', '/query/', params={'q': q}
    )
    if status != 200:
        logger.warning("Contact pull query failed: status=%s body=%s", status, body)
        return []
    return body.get('records', [])


def pull_contacts(conn, account_id, tokens):
    """Pull SF Contacts changed since last per-account timestamp.
    Returns a summary dict with counts."""
    since_iso = get_account_config(conn, account_id, 'salesforce_contact_last_pull_at')
    has_filter = 'XO_Sync_Enabled__c' in _describe_fields(
        conn, account_id, tokens, 'Contact'
    )

    records = _query_contacts(conn, account_id, tokens, since_iso, has_filter)

    summary = {
        'pulled': 0, 'inserted': 0, 'conflict': 0,
        'orphan': 0, 'noop': 0,
        'xo_sync_filter_applied': has_filter,
        'records_examined': len(records),
    }

    high_water = since_iso
    for rec in records:
        tag = _reconcile_contact(conn, account_id, rec)
        if tag in summary:
            summary[tag] += 1
        last_mod = rec.get('LastModifiedDate')
        if last_mod and (not high_water or last_mod > high_water):
            high_water = last_mod

    if high_water and high_water != since_iso:
        set_account_config(
            conn, account_id, 'salesforce_contact_last_pull_at', high_water
        )

    return summary
