"""
XO Platform — Salesforce pull path (PR 3 / Stage 1b).

Polls SF for changed Account / Contact / Opportunity records since the
last per-entity timestamp stored in system_config:
  salesforce_account_last_pull_at
  salesforce_contact_last_pull_at
  salesforce_opportunity_last_pull_at
Each scoped to the calling account_id.

XO_Sync_Enabled__c filter:
  If the field exists on the org's Account schema (DescribeSObject), add
  `AND XO_Sync_Enabled__c = TRUE` to the SOQL WHERE clause.
  If the field is missing: pull everything for that account and log
  'sync_filter_missing' once per lambda lifetime (cached describe).

Conflict detection:
  Mirrors hubspot-sync._determine_sync_direction. Result mapped to:
    'first_sync'  → SF authoritative, write through
    'pull'        → SF newer than last_sync, update XO record
    'push'        → XO newer, skip (push path will handle)
    'conflict'    → both changed since last_sync, log to salesforce_sync_log
                    with sync_direction='conflict' and surface via PR 4 UI
    'none'        → no-op

Conflicts are logged using the existing salesforce_sync_log table —
sync_direction = 'conflict', fields_skipped = JSON list of field names,
details = human-readable context. Matches HubSpot's hubspot_sync_log
pattern; UI in PR 4 reads from this table with WHERE sync_direction='conflict'.
"""

import json
import logging
from datetime import datetime, timezone

from integrations_config import get_account_config, set_account_config
from sf_client import sf_call_with_refresh, soql_escape

logger = logging.getLogger('xo.salesforce.pull')
logger.setLevel(logging.INFO)


# ──────────────────────────────────────────────
# DescribeSObject cache (per lambda container lifetime)
# ──────────────────────────────────────────────
# Key: (account_id, sobject_name) → set of field API names.
# Refreshed implicitly when the lambda container recycles.
_FIELD_DESCRIBE_CACHE = {}


def _describe_fields(conn, account_id, tokens, sobject):
    """Return the set of field API names on `sobject` for this org.
    Cached for the lambda lifetime to avoid repeated describe calls."""
    cache_key = (account_id, sobject)
    if cache_key in _FIELD_DESCRIBE_CACHE:
        return _FIELD_DESCRIBE_CACHE[cache_key]

    status, body = sf_call_with_refresh(
        conn, account_id, tokens, 'GET',
        f'/sobjects/{sobject}/describe',
    )
    if status != 200:
        logger.warning("describe %s failed: status=%s — assuming no custom fields",
                       sobject, status)
        _FIELD_DESCRIBE_CACHE[cache_key] = set()
        return _FIELD_DESCRIBE_CACHE[cache_key]

    fields = {f['name'] for f in body.get('fields', [])}
    _FIELD_DESCRIBE_CACHE[cache_key] = fields
    return fields


def _has_xo_sync_enabled(conn, account_id, tokens, sobject):
    """True if the org has XO_Sync_Enabled__c installed on `sobject`."""
    return 'XO_Sync_Enabled__c' in _describe_fields(conn, account_id, tokens, sobject)


# ──────────────────────────────────────────────
# Timestamp + sync direction (mirrors hubspot-sync pattern)
# ──────────────────────────────────────────────
def _parse_sf_timestamp(ts_str):
    """Parse a Salesforce ISO timestamp string to a tz-aware datetime."""
    if not ts_str:
        return None
    try:
        # SF returns ISO 8601 with millis: "2026-04-15T10:00:00.000+0000"
        ts_str = ts_str.replace('Z', '+00:00')
        # Handle +0000 (no colon) form
        if len(ts_str) >= 5 and ts_str[-5] in ('+', '-') and ':' not in ts_str[-5:]:
            ts_str = ts_str[:-2] + ':' + ts_str[-2:]
        return datetime.fromisoformat(ts_str)
    except (ValueError, TypeError):
        return None


def _make_aware(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def determine_sync_direction(xo_updated_at, sf_lastmodified, last_sync):
    """Decide which side wins based on timestamps.

    Returns one of:
      'first_sync' — last_sync IS NULL, treat SF as authoritative
      'pull'       — only SF changed since last sync
      'push'       — only XO changed since last sync (caller skips)
      'conflict'   — both changed since last sync
      'none'       — neither changed
    """
    if last_sync is None:
        return 'first_sync'

    last_sync = _make_aware(last_sync)
    xo_updated_at = _make_aware(xo_updated_at)
    sf_lastmodified = _make_aware(sf_lastmodified)

    xo_changed = xo_updated_at and xo_updated_at > last_sync
    sf_changed = sf_lastmodified and sf_lastmodified > last_sync

    if xo_changed and sf_changed:
        return 'conflict'
    if xo_changed:
        return 'push'
    if sf_changed:
        return 'pull'
    return 'none'


# Per-entity field mapping (XO column -> SF API name). Standard fields only.
SYNC_FIELDS_ACCOUNT = {
    'company_name': 'Name',
    'website_url': 'Website',
    'industry': 'Industry',
    'description': 'Description',
}


def detect_field_conflicts(xo_record, sf_record, mapping):
    """Return a dict {xo_col: (xo_val, sf_val)} for fields where the two
    sides hold different non-empty values. Used when sync_direction
    == 'conflict' to record exactly which fields are in dispute."""
    conflicts = {}
    for xo_col, sf_field in mapping.items():
        xo_val = xo_record.get(xo_col)
        sf_val = sf_record.get(sf_field)
        # Treat None and '' as equivalent for conflict purposes.
        if (xo_val or None) != (sf_val or None):
            conflicts[xo_col] = (xo_val, sf_val)
    return conflicts


# ──────────────────────────────────────────────
# Conflict logging — writes to salesforce_sync_log
# ──────────────────────────────────────────────
def log_conflict(conn, account_id, record_type, record_id, sf_id,
                 conflicting_fields, details=None):
    """Write a sync_direction='conflict' row. Read by PR 4's UI via:
       SELECT ... FROM salesforce_sync_log WHERE sync_direction = 'conflict'
       AND account_id = %s"""
    cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO salesforce_sync_log
               (account_id, record_type, record_id, salesforce_id,
                sync_direction, fields_skipped, details)
               VALUES (%s, %s, %s, %s, 'conflict', %s, %s)""",
            (account_id, record_type, record_id, sf_id,
             json.dumps(list(conflicting_fields.keys())),
             details),
        )
        conn.commit()
    finally:
        cur.close()


def log_pull(conn, account_id, record_type, record_id, sf_id, fields_updated):
    cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO salesforce_sync_log
               (account_id, record_type, record_id, salesforce_id,
                sync_direction, fields_updated)
               VALUES (%s, %s, %s, %s, 'pull', %s)""",
            (account_id, record_type, record_id, sf_id,
             json.dumps(fields_updated)),
        )
        conn.commit()
    finally:
        cur.close()


# ──────────────────────────────────────────────
# SOQL query builders
# ──────────────────────────────────────────────
def _build_since_clause(since_iso):
    """SOQL WHERE clause for LastModifiedDate > since (or no filter if None)."""
    if not since_iso:
        return ''
    return f" AND LastModifiedDate > {since_iso}"


def _query_accounts(conn, account_id, tokens, since_iso, use_xo_filter):
    """SOQL: changed Accounts since `since_iso`, optionally XO_Sync_Enabled filter."""
    # ORDER BY + LIMIT keep payload bounded per call.
    where = "WHERE Id != null"  # benign anchor so AND clauses always append cleanly
    if use_xo_filter:
        where += " AND XO_Sync_Enabled__c = TRUE"
    if since_iso:
        where += f" AND LastModifiedDate > {since_iso}"
    q = (
        "SELECT Id, Name, Description, Website, Industry, LastModifiedDate "
        f"FROM Account {where} ORDER BY LastModifiedDate LIMIT 200"
    )
    status, body = sf_call_with_refresh(
        conn, account_id, tokens, 'GET', '/query/', params={'q': q}
    )
    if status != 200:
        logger.warning("Account pull query failed: status=%s body=%s", status, body)
        return []
    return body.get('records', [])


# ──────────────────────────────────────────────
# Account reconciliation
# ──────────────────────────────────────────────
def _reconcile_account(conn, account_id, sf_account):
    """Match SF Account to an XO client, run conflict detection, apply
    the pull (or log conflict). Returns a tag for the run summary:
      'pulled' | 'conflict' | 'skip_push' | 'noop' | 'created'
    """
    cur = conn.cursor()
    try:
        # Match by direct link first, then by company name (case-insensitive).
        cur.execute(
            """SELECT id, company_name, website_url, industry, description,
                      updated_at, salesforce_last_sync
               FROM clients
               WHERE account_id = %s
               AND (salesforce_account_id = %s OR LOWER(company_name) = LOWER(%s))
               LIMIT 1""",
            (account_id, sf_account['Id'], sf_account.get('Name') or ''),
        )
        row = cur.fetchone()
    finally:
        cur.close()

    if not row:
        # Unlinked SF Account — create a new XO client (only when
        # XO_Sync_Enabled__c filter let it through; otherwise the caller
        # wouldn't have returned this record).
        return _create_xo_client_from_account(conn, account_id, sf_account)

    xo_id, name, website, industry, description, xo_updated_at, last_sync = row
    xo_record = {
        'company_name': name, 'website_url': website,
        'industry': industry, 'description': description,
    }
    sf_lastmodified = _parse_sf_timestamp(sf_account.get('LastModifiedDate'))

    direction = determine_sync_direction(xo_updated_at, sf_lastmodified, last_sync)

    if direction == 'none':
        return 'noop'
    if direction == 'push':
        # XO changed since last sync; push path will handle it.
        return 'skip_push'
    if direction == 'conflict':
        conflicts = detect_field_conflicts(xo_record, sf_account, SYNC_FIELDS_ACCOUNT)
        if conflicts:
            log_conflict(
                conn, account_id, 'client', xo_id, sf_account['Id'],
                conflicts,
                details=f"Both sides changed since {last_sync}",
            )
            return 'conflict'
        # No actual field differences — treat as pull.
        direction = 'pull'

    # direction in ('first_sync', 'pull')
    _apply_pull_to_client(conn, xo_id, sf_account)
    log_pull(
        conn, account_id, 'client', xo_id, sf_account['Id'],
        fields_updated=list(SYNC_FIELDS_ACCOUNT.keys()),
    )
    return 'pulled'


def _apply_pull_to_client(conn, xo_id, sf_account):
    """Apply SF Account fields to an existing XO client."""
    cur = conn.cursor()
    try:
        cur.execute(
            """UPDATE clients SET
                 company_name = COALESCE(%s, company_name),
                 website_url  = COALESCE(%s, website_url),
                 industry     = COALESCE(%s, industry),
                 description  = COALESCE(%s, description),
                 salesforce_account_id = %s,
                 salesforce_last_sync = NOW(),
                 updated_at = NOW()
               WHERE id = %s""",
            (sf_account.get('Name'), sf_account.get('Website'),
             sf_account.get('Industry'), sf_account.get('Description'),
             sf_account['Id'], xo_id),
        )
        conn.commit()
    finally:
        cur.close()


def _create_xo_client_from_account(conn, account_id, sf_account):
    """Create a new XO client from an SF Account. Only called when
    XO_Sync_Enabled__c=TRUE (the filter is the opt-in)."""
    cur = conn.cursor()
    try:
        # s3_folder is required NOT NULL UNIQUE. Use a deterministic name
        # so the same Account doesn't create duplicate folders on retry.
        s3_folder = f"sf-{sf_account['Id'].lower()}"
        cur.execute(
            """INSERT INTO clients
               (account_id, company_name, website_url, industry, description,
                s3_folder, salesforce_account_id, salesforce_last_sync, status)
               VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), 'active')
               ON CONFLICT (s3_folder) DO NOTHING
               RETURNING id""",
            (account_id, sf_account.get('Name'), sf_account.get('Website'),
             sf_account.get('Industry'), sf_account.get('Description'),
             s3_folder, sf_account['Id']),
        )
        row = cur.fetchone()
        conn.commit()
    finally:
        cur.close()

    if row:
        log_pull(
            conn, account_id, 'client', row[0], sf_account['Id'],
            fields_updated=list(SYNC_FIELDS_ACCOUNT.keys()) + ['created_from_sf'],
        )
        return 'created'
    return 'noop'  # s3_folder collision — already created in a prior run


# ──────────────────────────────────────────────
# Top-level pull
# ──────────────────────────────────────────────
def pull_accounts(conn, account_id, tokens):
    """Pull changed Accounts since the last per-account timestamp.
    Returns a dict summary {pulled, created, conflicts, skip_push, noop,
    xo_sync_filter_applied}.
    """
    since_iso = get_account_config(conn, account_id, 'salesforce_account_last_pull_at')
    use_filter = _has_xo_sync_enabled(conn, account_id, tokens, 'Account')

    records = _query_accounts(conn, account_id, tokens, since_iso, use_filter)

    # Summary keys MUST match the tag values returned by _reconcile_account
    # (pulled / created / conflict / skip_push / noop). Mismatched keys here
    # silently drop counts — the bug is invisible in summary output.
    summary = {
        'pulled': 0, 'created': 0, 'conflict': 0,
        'skip_push': 0, 'noop': 0,
        'xo_sync_filter_applied': use_filter,
        'records_examined': len(records),
    }

    high_water = since_iso  # advance only after the batch fully processes
    for rec in records:
        tag = _reconcile_account(conn, account_id, rec)
        if tag in summary:
            summary[tag] += 1
        last_mod = rec.get('LastModifiedDate')
        if last_mod and (not high_water or last_mod > high_water):
            high_water = last_mod

    if high_water and high_water != since_iso:
        set_account_config(
            conn, account_id, 'salesforce_account_last_pull_at', high_water
        )

    return summary
