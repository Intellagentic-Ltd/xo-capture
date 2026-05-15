"""
XO Platform — Salesforce Opportunity pull (PR 3.5 / Stage 1b completion).

Each SF Opportunity maps to an XO engagement row, linked via
engagements.salesforce_opportunity_id. AccountId on the Opportunity
resolves to an XO client through client_salesforce_links (per-tenant).

PER-ENTITY TIMESTAMP
  salesforce_opportunity_last_pull_at (account_id-scoped).

RECONCILE
  Match priority: engagements.salesforce_opportunity_id, then
  (client_id, LOWER(name)). Create-when-missing if the linked client
  exists; orphan-log if no link.
"""

import json
import logging
from datetime import datetime, timezone

from integrations_config import get_account_config, set_account_config
from sf_client import sf_call_with_refresh
from sf_pull import (
    _describe_fields, _parse_sf_timestamp, determine_sync_direction,
)

logger = logging.getLogger('xo.salesforce.opportunity_pull')
logger.setLevel(logging.INFO)


SYNC_FIELDS_OPPORTUNITY = {
    # XO engagement column → SF Opportunity field
    'name': 'Name',
    'stage': 'StageName',
    'amount': 'Amount',
    'close_date': 'CloseDate',
    'description': 'Description',
}


# ──────────────────────────────────────────────
# Linked-client lookup
# ──────────────────────────────────────────────
def _find_linked_xo_client(conn, account_id, sf_account_id):
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


# ──────────────────────────────────────────────
# Engagement match + conflict
# ──────────────────────────────────────────────
def _find_engagement(conn, client_id, sf_opportunity):
    """Match by salesforce_opportunity_id first, then by (client, name).
    Returns row tuple or None."""
    cur = conn.cursor()
    try:
        cur.execute(
            """SELECT id, name, stage, amount, close_date, description,
                      updated_at, salesforce_synced_at
               FROM engagements
               WHERE client_id = %s AND salesforce_opportunity_id = %s
               LIMIT 1""",
            (client_id, sf_opportunity.get('Id')),
        )
        row = cur.fetchone()
        if row:
            return row
        cur.execute(
            """SELECT id, name, stage, amount, close_date, description,
                      updated_at, salesforce_synced_at
               FROM engagements
               WHERE client_id = %s AND LOWER(name) = LOWER(%s)
               LIMIT 1""",
            (client_id, sf_opportunity.get('Name') or ''),
        )
        return cur.fetchone()
    finally:
        cur.close()


def _detect_field_diffs(xo_eng_dict: dict, sf_opp: dict) -> dict:
    """Return {xo_col: (xo_val, sf_val)} for fields that differ."""
    diffs = {}
    for xo_col, sf_field in SYNC_FIELDS_OPPORTUNITY.items():
        xo_val = xo_eng_dict.get(xo_col)
        sf_val = sf_opp.get(sf_field)
        if (xo_val or None) != (sf_val or None):
            diffs[xo_col] = (xo_val, sf_val)
    return diffs


def _log_conflict(conn, account_id, engagement_id, sf_id, diffs):
    cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO salesforce_sync_log
                   (account_id, record_type, record_id, salesforce_id,
                    sync_direction, fields_skipped, details)
               VALUES (%s, 'engagement', %s, %s, 'conflict', %s, %s)""",
            (
                account_id, engagement_id, sf_id,
                json.dumps(list(diffs.keys())),
                json.dumps({k: list(v) for k, v in diffs.items()}),
            ),
        )
        conn.commit()
    finally:
        cur.close()


def _log_pull(conn, account_id, engagement_id, sf_id, fields):
    cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO salesforce_sync_log
                   (account_id, record_type, record_id, salesforce_id,
                    sync_direction, fields_updated)
               VALUES (%s, 'engagement', %s, %s, 'pull', %s)""",
            (account_id, engagement_id, sf_id, json.dumps(fields)),
        )
        conn.commit()
    finally:
        cur.close()


def _log_orphan(conn, account_id, sf_id, details):
    cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO salesforce_sync_log
                   (account_id, record_type, salesforce_id,
                    sync_direction, details)
               VALUES (%s, 'engagement', %s, 'pull', %s)""",
            (account_id, sf_id, details),
        )
        conn.commit()
    finally:
        cur.close()


def _apply_to_engagement(conn, eng_id, sf_opp, account_id):
    cur = conn.cursor()
    try:
        cur.execute(
            """UPDATE engagements SET
                 name = COALESCE(%s, name),
                 stage = COALESCE(%s, stage),
                 amount = COALESCE(%s, amount),
                 close_date = COALESCE(%s, close_date),
                 description = COALESCE(%s, description),
                 salesforce_opportunity_id = %s,
                 salesforce_synced_at = NOW(),
                 updated_at = NOW()
               WHERE id = %s""",
            (
                sf_opp.get('Name'), sf_opp.get('StageName'), sf_opp.get('Amount'),
                sf_opp.get('CloseDate'), sf_opp.get('Description'),
                sf_opp.get('Id'), eng_id,
            ),
        )
        conn.commit()
    finally:
        cur.close()


def _create_engagement(conn, account_id, xo_client_id, sf_opp):
    """Insert a new engagement for this SF Opportunity. Returns engagement uuid."""
    cur = conn.cursor()
    try:
        # The engagements table schema (PR 1) has: id, client_id, name,
        # focus_area, contacts_json, status, approved_*, created/updated_at,
        # hubspot_deal_id. We add SF Opportunity fields opportunistically —
        # `stage`, `amount`, `close_date`, `description` may not yet exist
        # as columns. ALTER TABLE ADD COLUMN IF NOT EXISTS handles that
        # in _run_salesforce_migrations. PR 3.5 leans on that.
        cur.execute(
            """INSERT INTO engagements
                   (client_id, name, status,
                    salesforce_opportunity_id, salesforce_synced_at)
               VALUES (%s, %s, 'active', %s, NOW())
               RETURNING id""",
            (xo_client_id, sf_opp.get('Name') or 'Untitled Opportunity',
             sf_opp.get('Id')),
        )
        row = cur.fetchone()
        conn.commit()
    finally:
        cur.close()
    return row[0] if row else None


# ──────────────────────────────────────────────
# Single-record reconcile (also used by webhook)
# ──────────────────────────────────────────────
def _reconcile_opportunity(conn, account_id, sf_opp):
    sf_account_id = sf_opp.get('AccountId')
    if not sf_account_id:
        _log_orphan(conn, account_id, sf_opp.get('Id'),
                    'opportunity orphaned, no AccountId on SF record')
        return 'orphan'

    xo_client_id = _find_linked_xo_client(conn, account_id, sf_account_id)
    if not xo_client_id:
        _log_orphan(conn, account_id, sf_opp.get('Id'),
                    'opportunity orphaned, no linked XO client')
        return 'orphan'

    eng_row = _find_engagement(conn, xo_client_id, sf_opp)
    if not eng_row:
        eng_id = _create_engagement(conn, account_id, xo_client_id, sf_opp)
        if eng_id:
            _log_pull(conn, account_id, eng_id, sf_opp.get('Id'),
                      list(SYNC_FIELDS_OPPORTUNITY.keys()) + ['created_from_sf'])
            return 'created'
        return 'noop'

    eng_id, name, stage, amount, close_date, description, updated_at, last_sync = eng_row
    xo_dict = {
        'name': name, 'stage': stage, 'amount': amount,
        'close_date': close_date, 'description': description,
    }
    sf_last_modified = _parse_sf_timestamp(sf_opp.get('LastModifiedDate'))

    direction = determine_sync_direction(updated_at, sf_last_modified, last_sync)

    if direction == 'none':
        return 'noop'
    if direction == 'push':
        return 'skip_push'
    if direction == 'conflict':
        diffs = _detect_field_diffs(xo_dict, sf_opp)
        if diffs:
            _log_conflict(conn, account_id, eng_id, sf_opp.get('Id'), diffs)
            return 'conflict'
        direction = 'pull'

    # 'first_sync' or 'pull'
    _apply_to_engagement(conn, eng_id, sf_opp, account_id)
    _log_pull(conn, account_id, eng_id, sf_opp.get('Id'),
              list(SYNC_FIELDS_OPPORTUNITY.keys()))
    return 'pulled'


# ──────────────────────────────────────────────
# Batch pull
# ──────────────────────────────────────────────
def _query_opportunities(conn, account_id, tokens, since_iso, use_xo_filter):
    where = "WHERE Id != null"
    if use_xo_filter:
        where += " AND XO_Sync_Enabled__c = TRUE"
    if since_iso:
        where += f" AND LastModifiedDate > {since_iso}"
    q = (
        "SELECT Id, Name, AccountId, StageName, Amount, CloseDate, "
        "Description, LastModifiedDate "
        f"FROM Opportunity {where} ORDER BY LastModifiedDate LIMIT 200"
    )
    status, body = sf_call_with_refresh(
        conn, account_id, tokens, 'GET', '/query/', params={'q': q}
    )
    if status != 200:
        logger.warning("Opportunity pull query failed: status=%s body=%s",
                       status, body)
        return []
    return body.get('records', [])


def pull_opportunities(conn, account_id, tokens):
    since_iso = get_account_config(
        conn, account_id, 'salesforce_opportunity_last_pull_at'
    )
    has_filter = 'XO_Sync_Enabled__c' in _describe_fields(
        conn, account_id, tokens, 'Opportunity'
    )

    records = _query_opportunities(conn, account_id, tokens, since_iso, has_filter)

    summary = {
        'pulled': 0, 'created': 0, 'conflict': 0,
        'skip_push': 0, 'orphan': 0, 'noop': 0,
        'xo_sync_filter_applied': has_filter,
        'records_examined': len(records),
    }

    high_water = since_iso
    for rec in records:
        tag = _reconcile_opportunity(conn, account_id, rec)
        if tag in summary:
            summary[tag] += 1
        last_mod = rec.get('LastModifiedDate')
        if last_mod and (not high_water or last_mod > high_water):
            high_water = last_mod

    if high_water and high_water != since_iso:
        set_account_config(
            conn, account_id, 'salesforce_opportunity_last_pull_at', high_water
        )

    return summary
