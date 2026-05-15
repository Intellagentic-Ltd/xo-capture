"""
XO Platform — Salesforce Outbound Message webhook (PR 3 / Stage 1b).

Salesforce Outbound Messages POST a SOAP envelope to a configured URL.
SF retries for up to 24 hours unless we return a SOAP ACK with Ack=true.

SECURITY MODEL — no shared secret, no HMAC.
  SF doesn't sign Outbound Messages. The auth boundary is a two-factor
  check:
    1. URL carries ?account_id=<id> (soft secret, per-account endpoint).
    2. SOAP body carries <OrganizationId> from the SF org.
  We compare the URL's account_id's stored salesforce_org_id (from
  system_config) against the SOAP's OrganizationId. Both must match.

  First-time bootstrapping: if no org_id is cached for the account_id,
  we fetch it from /services/oauth2/userinfo using the account's stored
  access token, then verify against the incoming SOAP. An attacker who
  triggers the webhook for an account that hasn't yet connected SF gets
  Ack=false because there are no tokens to bootstrap with.

  Cross-account spoof: URL says account_id=42, SOAP says OrganizationId
  belongs to account 99. Account 42's stored org_id doesn't match → Ack=false.

PARSING
  xml.etree.ElementTree (stdlib). No lxml dependency.

ACK FORMAT
  Salesforce expects this exact envelope (whitespace tolerant, but the
  element names + namespaces matter):

    <?xml version="1.0" encoding="UTF-8"?>
    <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
      <soapenv:Body>
        <notificationsResponse xmlns="http://soap.sforce.com/2005/09/outbound">
          <Ack>true</Ack>
        </notificationsResponse>
      </soapenv:Body>
    </soapenv:Envelope>
"""

import logging
import xml.etree.ElementTree as ET

from integrations_config import get_account_config, set_account_config
from sf_client import fetch_org_id, read_account_tokens
from sf_pull import _reconcile_account
from sf_contact_pull import _reconcile_contact
from sf_opportunity_pull import _reconcile_opportunity

logger = logging.getLogger('xo.salesforce.webhook')
logger.setLevel(logging.INFO)


SF_OUTBOUND_NS = 'http://soap.sforce.com/2005/09/outbound'
SOAP_NS = 'http://schemas.xmlsoap.org/soap/envelope/'


# ──────────────────────────────────────────────
# SOAP parsing
# ──────────────────────────────────────────────
class WebhookParseError(Exception):
    """Raised when the SOAP body is malformed enough that we can't even
    extract OrganizationId. Returns Ack=false at the route layer."""


def _parse_outbound_message(body_bytes_or_str):
    """Parse a Salesforce Outbound Message SOAP envelope.

    Returns a dict:
      {
        'organization_id': '00D...',
        'notifications': [
          {'id': '...', 'sobject_type': 'Account',
           'fields': {'Id': '001...', 'Name': '...', ...}},
          ...
        ]
      }
    Raises WebhookParseError on unparseable XML or missing required nodes.
    """
    if not body_bytes_or_str:
        raise WebhookParseError("empty body")
    try:
        if isinstance(body_bytes_or_str, str):
            root = ET.fromstring(body_bytes_or_str)
        else:
            root = ET.fromstring(body_bytes_or_str)
    except ET.ParseError as e:
        raise WebhookParseError(f"XML parse failed: {e}") from e

    # The <notifications> element is namespaced under SF_OUTBOUND_NS.
    notifications_el = root.find(f'.//{{{SF_OUTBOUND_NS}}}notifications')
    if notifications_el is None:
        raise WebhookParseError("missing <notifications> element")

    org_id_el = notifications_el.find(f'{{{SF_OUTBOUND_NS}}}OrganizationId')
    if org_id_el is None or not (org_id_el.text or '').strip():
        raise WebhookParseError("missing or empty <OrganizationId>")

    notifications = []
    for notif_el in notifications_el.findall(f'{{{SF_OUTBOUND_NS}}}Notification'):
        notif = {'id': None, 'sobject_type': None, 'fields': {}}

        id_el = notif_el.find(f'{{{SF_OUTBOUND_NS}}}Id')
        if id_el is not None:
            notif['id'] = (id_el.text or '').strip()

        sobject_el = notif_el.find(f'{{{SF_OUTBOUND_NS}}}sObject')
        if sobject_el is None:
            continue  # malformed notification — skip but don't fail the whole batch

        # xsi:type carries the SObject type, e.g. "sf:Account". Strip the prefix.
        xsi_type = sobject_el.get('{http://www.w3.org/2001/XMLSchema-instance}type', '')
        if ':' in xsi_type:
            notif['sobject_type'] = xsi_type.split(':', 1)[1]
        else:
            notif['sobject_type'] = xsi_type or None

        # All sObject children are namespaced under
        # urn:sobject.enterprise.soap.sforce.com (prefix "sf:" in SF's output).
        # We don't validate the exact namespace — we just pull tag local-names.
        for child in sobject_el:
            tag = child.tag
            if '}' in tag:
                tag = tag.split('}', 1)[1]
            notif['fields'][tag] = (child.text or '').strip() if child.text else None

        notifications.append(notif)

    return {
        'organization_id': org_id_el.text.strip(),
        'notifications': notifications,
    }


# ──────────────────────────────────────────────
# ACK builders
# ──────────────────────────────────────────────
def _build_ack(ack_bool):
    """Return the exact SOAP ACK XML Salesforce expects."""
    value = 'true' if ack_bool else 'false'
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<soapenv:Envelope '
        'xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">'
        '<soapenv:Body>'
        f'<notificationsResponse xmlns="{SF_OUTBOUND_NS}">'
        f'<Ack>{value}</Ack>'
        '</notificationsResponse>'
        '</soapenv:Body>'
        '</soapenv:Envelope>'
    )


def _ack_response(ack_bool, status=200):
    return {
        'statusCode': status,
        'headers': {
            'Content-Type': 'text/xml; charset=utf-8',
        },
        'body': _build_ack(ack_bool),
    }


# ──────────────────────────────────────────────
# OrganizationId verification (the auth boundary)
# ──────────────────────────────────────────────
def _verify_org_id(conn, account_id, claimed_org_id):
    """Compare claimed OrganizationId against the account_id's stored
    salesforce_org_id. Bootstraps from /oauth2/userinfo on first call.

    Returns True on match, False otherwise. False on bootstrap failure
    (e.g., account never connected SF — no tokens to fetch with).
    """
    stored = get_account_config(conn, account_id, 'salesforce_org_id')
    if stored:
        return stored == claimed_org_id

    # Bootstrap: fetch the org_id using the account's existing tokens.
    tokens = read_account_tokens(conn, account_id)
    if not tokens:
        logger.warning(
            "webhook account_id=%s has no SF tokens; cannot bootstrap org_id "
            "— rejecting (likely spoof or pre-connect probe)",
            account_id,
        )
        return False

    actual_org_id = fetch_org_id(tokens['access_token'], tokens['instance_url'])
    if not actual_org_id:
        logger.warning(
            "webhook account_id=%s: org_id fetch failed; cannot verify — rejecting",
            account_id,
        )
        return False

    # Persist for next time.
    set_account_config(conn, account_id, 'salesforce_org_id', actual_org_id)

    return actual_org_id == claimed_org_id


def _log_spoof_attempt(conn, account_id, claimed_org_id, details=None):
    """Record a webhook rejection as a sync log row for audit/alerting.
    Uses sync_direction='spoof' — fits inside the VARCHAR(10) column."""
    cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO salesforce_sync_log
               (account_id, record_type, salesforce_id,
                sync_direction, details)
               VALUES (%s, 'webhook', %s, 'spoof', %s)""",
            (account_id, claimed_org_id,
             details or 'OrganizationId did not match stored org_id'),
        )
        conn.commit()
    finally:
        cur.close()


# ──────────────────────────────────────────────
# Public entry point
# ──────────────────────────────────────────────
def handle_outbound_message(event, get_db_connection):
    """POST /webhooks/salesforce/outbound-message?account_id={id}

    `get_db_connection` is passed in from the lambda's auth_helper.
    Keeping it as a parameter (rather than importing) makes this module
    cheaper to test in isolation.

    Always returns 200 with a SOAP ACK body (Ack=true or Ack=false).
    SF retries forever on non-200; returning Ack=false in a 200 envelope
    tells SF to stop retrying without our http layer erroring out.
    """
    params = event.get('queryStringParameters') or {}
    account_id_param = params.get('account_id')
    if not account_id_param:
        logger.warning("webhook missing account_id query param")
        return _ack_response(False)
    try:
        account_id = int(account_id_param)
    except (ValueError, TypeError):
        logger.warning("webhook account_id not int: %r", account_id_param)
        return _ack_response(False)

    body = event.get('body') or ''
    try:
        parsed = _parse_outbound_message(body)
    except WebhookParseError as e:
        logger.warning("webhook SOAP parse failed for account_id=%s: %s", account_id, e)
        return _ack_response(False)

    claimed_org_id = parsed['organization_id']

    conn = get_db_connection()
    try:
        if not _verify_org_id(conn, account_id, claimed_org_id):
            _log_spoof_attempt(
                conn, account_id, claimed_org_id,
                details=f"URL account_id={account_id} stored org_id "
                        f"does not match SOAP OrganizationId={claimed_org_id}",
            )
            return _ack_response(False)

        # PR 3.5: Account, Contact, Opportunity all reconcile via dedicated
        # modules. Per-record errors are caught so one bad record doesn't
        # cascade SF retries across the whole batch.
        _RECONCILERS = {
            'Account': _reconcile_account,
            'Contact': _reconcile_contact,
            'Opportunity': _reconcile_opportunity,
        }
        for notif in parsed['notifications']:
            sobject_type = notif.get('sobject_type')
            fields = notif.get('fields') or {}
            reconciler = _RECONCILERS.get(sobject_type)
            if reconciler and fields.get('Id'):
                try:
                    reconciler(conn, account_id, fields)
                except Exception as e:
                    logger.exception(
                        "webhook reconcile failed for %s=%s account_id=%s: %s",
                        sobject_type, fields.get('Id'), account_id, e,
                    )
            else:
                logger.info(
                    "webhook ignoring sobject_type=%s (no reconciler registered)",
                    sobject_type,
                )

    finally:
        conn.close()

    return _ack_response(True)
