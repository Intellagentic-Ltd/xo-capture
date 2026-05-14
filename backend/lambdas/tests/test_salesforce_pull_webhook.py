"""
Regression tests for PR 3 / Stage 1b — SF pull + Outbound Message webhook.

Coverage per Ken's PR 3 test list:
  1. Pull happy path with XO_Sync_Enabled__c filter applied
  2. Pull fallback when XO_Sync_Enabled__c is absent on the org
  3. Conflict detection — local newer / SF newer / both changed
  4. Outbound Message: valid org_id → Ack=true + payload processed
  5. Outbound Message: wrong org_id → Ack=false + no processing + spoof log
  6. Outbound Message: missing org_id in SOAP → Ack=false
  7. Outbound Message: first-time call fetches and stores org_id, then verifies
  8. Outbound Message: tampered SOAP body → parse failure handled
  9. Tenant leak: URL account_id + OrganizationId must both resolve to same account
 10. ACK XML format — verify structural correctness
"""

import os
import sys
import importlib
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'salesforce-sync'))


@pytest.fixture
def sf_pull_module():
    """Fresh import of sf_pull with sf_client.requests + integrations_config mockable."""
    with patch.dict(os.environ, {
        'DATABASE_URL': 'postgresql://fake',
        'SALESFORCE_CLIENT_ID': 'sf-id',
        'SALESFORCE_CLIENT_SECRET': 'sf-secret',
        'SALESFORCE_REDIRECT_URI': 'https://xo/cb',
    }):
        for mod in ('sf_client', 'sf_pull', 'sf_webhook'):
            if mod in sys.modules:
                del sys.modules[mod]
        import sf_pull
        importlib.reload(sf_pull)
        # Clear describe cache between tests so XO_Sync filter fallback can flip.
        sf_pull._FIELD_DESCRIBE_CACHE.clear()
        yield sf_pull
        sf_pull._FIELD_DESCRIBE_CACHE.clear()


@pytest.fixture
def sf_webhook_module():
    with patch.dict(os.environ, {
        'DATABASE_URL': 'postgresql://fake',
        'SALESFORCE_CLIENT_ID': 'sf-id',
        'SALESFORCE_CLIENT_SECRET': 'sf-secret',
        'SALESFORCE_REDIRECT_URI': 'https://xo/cb',
    }):
        for mod in ('sf_client', 'sf_pull', 'sf_webhook'):
            if mod in sys.modules:
                del sys.modules[mod]
        import sf_webhook
        importlib.reload(sf_webhook)
        yield sf_webhook


@pytest.fixture
def mock_conn():
    cur = MagicMock()
    cur.fetchone.return_value = None
    cur.fetchall.return_value = []
    conn = MagicMock()
    conn.cursor.return_value = cur
    return conn, cur


# ──────────────────────────────────────────────
# (3) Conflict detection — pure unit, no I/O
# ──────────────────────────────────────────────

class TestDetermineSyncDirection:
    def test_first_sync_when_last_sync_null(self, sf_pull_module):
        now = datetime.now(timezone.utc)
        assert sf_pull_module.determine_sync_direction(now, now, None) == 'first_sync'

    def test_only_sf_changed_returns_pull(self, sf_pull_module):
        last = datetime.now(timezone.utc) - timedelta(hours=1)
        xo = last - timedelta(minutes=10)         # XO older than last_sync
        sf = last + timedelta(minutes=10)         # SF newer than last_sync
        assert sf_pull_module.determine_sync_direction(xo, sf, last) == 'pull'

    def test_only_xo_changed_returns_push(self, sf_pull_module):
        last = datetime.now(timezone.utc) - timedelta(hours=1)
        xo = last + timedelta(minutes=10)
        sf = last - timedelta(minutes=10)
        assert sf_pull_module.determine_sync_direction(xo, sf, last) == 'push'

    def test_both_changed_returns_conflict(self, sf_pull_module):
        last = datetime.now(timezone.utc) - timedelta(hours=1)
        later_xo = last + timedelta(minutes=5)
        later_sf = last + timedelta(minutes=10)
        assert sf_pull_module.determine_sync_direction(later_xo, later_sf, last) == 'conflict'

    def test_neither_changed_returns_none(self, sf_pull_module):
        last = datetime.now(timezone.utc)
        old_xo = last - timedelta(hours=2)
        old_sf = last - timedelta(hours=2)
        assert sf_pull_module.determine_sync_direction(old_xo, old_sf, last) == 'none'


class TestDetectFieldConflicts:
    def test_returns_only_differing_fields(self, sf_pull_module):
        xo = {'company_name': 'Acme', 'website_url': 'https://acme.com',
              'industry': 'Tech', 'description': 'A startup'}
        sf = {'Name': 'Acme Corp',           # different
              'Website': 'https://acme.com',  # same
              'Industry': 'Tech',             # same
              'Description': 'A startup'}     # same
        conflicts = sf_pull_module.detect_field_conflicts(
            xo, sf, sf_pull_module.SYNC_FIELDS_ACCOUNT
        )
        assert set(conflicts.keys()) == {'company_name'}
        assert conflicts['company_name'] == ('Acme', 'Acme Corp')

    def test_treats_none_and_empty_as_equivalent(self, sf_pull_module):
        xo = {'company_name': 'Acme', 'website_url': None}
        sf = {'Name': 'Acme', 'Website': ''}
        conflicts = sf_pull_module.detect_field_conflicts(
            xo, sf, sf_pull_module.SYNC_FIELDS_ACCOUNT
        )
        assert conflicts == {}


# ──────────────────────────────────────────────
# (1) (2) Pull — XO_Sync_Enabled filter + fallback
# ──────────────────────────────────────────────

class TestPullXoSyncEnabledFilter:
    def test_filter_applied_when_field_exists(self, sf_pull_module, mock_conn):
        conn, cur = mock_conn
        with patch('sf_pull.sf_call_with_refresh') as mock_call, \
             patch('sf_pull.get_account_config', return_value=None), \
             patch('sf_pull.set_account_config'):
            # First call: describe → returns the custom field
            describe_resp = {
                'fields': [
                    {'name': 'Id'}, {'name': 'Name'},
                    {'name': 'XO_Sync_Enabled__c'},
                ],
            }
            query_resp = {'records': []}
            mock_call.side_effect = [(200, describe_resp), (200, query_resp)]

            summary = sf_pull_module.pull_accounts(
                conn, account_id=42,
                tokens={'access_token': 'AT', 'refresh_token': 'RT',
                        'instance_url': 'https://acme.my.salesforce.com'},
            )

            assert summary['xo_sync_filter_applied'] is True
            # Second call (the query) — assert the SOQL carries the filter.
            query_call = mock_call.call_args_list[1]
            soql = query_call.kwargs['params']['q']
            assert 'XO_Sync_Enabled__c = TRUE' in soql

    def test_fallback_when_field_absent(self, sf_pull_module, mock_conn):
        conn, cur = mock_conn
        with patch('sf_pull.sf_call_with_refresh') as mock_call, \
             patch('sf_pull.get_account_config', return_value=None), \
             patch('sf_pull.set_account_config'):
            # Describe doesn't include XO_Sync_Enabled__c
            describe_resp = {'fields': [{'name': 'Id'}, {'name': 'Name'}]}
            query_resp = {'records': []}
            mock_call.side_effect = [(200, describe_resp), (200, query_resp)]

            summary = sf_pull_module.pull_accounts(
                conn, account_id=42,
                tokens={'access_token': 'AT', 'refresh_token': 'RT',
                        'instance_url': 'https://acme.my.salesforce.com'},
            )
            assert summary['xo_sync_filter_applied'] is False
            soql = mock_call.call_args_list[1].kwargs['params']['q']
            assert 'XO_Sync_Enabled__c' not in soql


class TestPullHappyPath:
    def test_pull_updates_matching_xo_client(self, sf_pull_module, mock_conn):
        """SF returns one Account; an XO client matches by name; SF is newer."""
        conn, cur = mock_conn
        cur.fetchone.return_value = (
            'xo-uuid-1', 'Acme', 'old-website.com', 'OldIndustry', 'old desc',
            datetime(2026, 1, 1, tzinfo=timezone.utc),     # xo updated_at
            datetime(2026, 1, 1, tzinfo=timezone.utc),     # salesforce_last_sync
        )
        with patch('sf_pull.sf_call_with_refresh') as mock_call, \
             patch('sf_pull.get_account_config', return_value=None), \
             patch('sf_pull.set_account_config') as mock_set:
            describe_resp = {'fields': [{'name': 'XO_Sync_Enabled__c'}]}
            sf_record = {
                'Id': '001ABC', 'Name': 'Acme',
                'Description': 'NEW description from SF',
                'Website': 'new-acme.com', 'Industry': 'NewIndustry',
                'LastModifiedDate': '2026-04-15T10:00:00.000+00:00',
            }
            query_resp = {'records': [sf_record]}
            mock_call.side_effect = [(200, describe_resp), (200, query_resp)]

            summary = sf_pull_module.pull_accounts(
                conn, account_id=42,
                tokens={'access_token': 'AT', 'refresh_token': 'RT',
                        'instance_url': 'https://acme.my.salesforce.com'},
            )

            assert summary['pulled'] == 1
            assert summary['conflict'] == 0
            # high-water timestamp persisted
            wm_call = [c for c in mock_set.call_args_list
                       if c.args[2] == 'salesforce_account_last_pull_at']
            assert len(wm_call) == 1
            assert wm_call[0].args[3] == '2026-04-15T10:00:00.000+00:00'
            # The high-water write is scoped to the JWT account_id
            assert wm_call[0].args[1] == 42


class TestPullConflictPath:
    def test_pull_logs_conflict_when_both_changed_with_diff(
            self, sf_pull_module, mock_conn):
        conn, cur = mock_conn
        last_sync = datetime(2026, 4, 10, tzinfo=timezone.utc)
        cur.fetchone.return_value = (
            'xo-uuid-2', 'Acme', 'https://acme.com', 'Tech', 'old desc',
            datetime(2026, 4, 14, tzinfo=timezone.utc),   # xo updated after last
            last_sync,
        )
        with patch('sf_pull.sf_call_with_refresh') as mock_call, \
             patch('sf_pull.get_account_config', return_value=None), \
             patch('sf_pull.set_account_config'):
            describe_resp = {'fields': []}
            sf_record = {
                'Id': '001XYZ', 'Name': 'Acme Corp',  # differs from XO 'Acme'
                'Description': 'new desc',
                'Website': 'https://acme.com', 'Industry': 'Tech',
                'LastModifiedDate': '2026-04-15T10:00:00.000+00:00',
            }
            mock_call.side_effect = [(200, describe_resp),
                                     (200, {'records': [sf_record]})]

            summary = sf_pull_module.pull_accounts(
                conn, account_id=42,
                tokens={'access_token': 'AT', 'refresh_token': 'RT',
                        'instance_url': 'https://acme.my.salesforce.com'},
            )

            assert summary['conflict'] == 1
            # The salesforce_sync_log INSERT must have run with
            # sync_direction='conflict' scoped to account_id=42.
            log_inserts = [
                c for c in cur.execute.call_args_list
                if 'salesforce_sync_log' in c.args[0]
                and "'conflict'" in c.args[0]
            ]
            assert len(log_inserts) == 1
            params = log_inserts[0].args[1]
            assert params[0] == 42       # account_id (JWT)
            assert params[1] == 'client' # record_type
            assert params[3] == '001XYZ' # salesforce_id


# ──────────────────────────────────────────────
# (4)-(9) Outbound Message webhook
# ──────────────────────────────────────────────

VALID_SOAP = """<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <notifications xmlns="http://soap.sforce.com/2005/09/outbound">
      <OrganizationId>00DAAAAAAAAAAAAAAA</OrganizationId>
      <ActionId>04kAAAAAAAAAAAAAAA</ActionId>
      <SessionId>SID</SessionId>
      <EnterpriseUrl>https://e.example/</EnterpriseUrl>
      <PartnerUrl>https://p.example/</PartnerUrl>
      <Notification>
        <Id>04lAAAAAAAAAAAAAAA</Id>
        <sObject xsi:type="sf:Account"
                 xmlns:sf="urn:sobject.enterprise.soap.sforce.com"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
          <sf:Id>001AAAAAAAAAAAAAAA</sf:Id>
          <sf:Name>Acme via OM</sf:Name>
          <sf:Description>From outbound</sf:Description>
        </sObject>
      </Notification>
    </notifications>
  </soapenv:Body>
</soapenv:Envelope>"""


SOAP_NO_ORG_ID = """<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <notifications xmlns="http://soap.sforce.com/2005/09/outbound">
      <ActionId>x</ActionId>
      <Notification><Id>n1</Id>
        <sObject xsi:type="sf:Account"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
          <sf:Id xmlns:sf="urn:sf">001</sf:Id>
        </sObject>
      </Notification>
    </notifications>
  </soapenv:Body>
</soapenv:Envelope>"""


TAMPERED_SOAP = "<not-xml<<<<>>"


class TestAckFormat:
    def test_ack_true_xml_structure(self, sf_webhook_module):
        body = sf_webhook_module._build_ack(True)
        assert body.startswith('<?xml version="1.0" encoding="UTF-8"?>')
        assert '<Ack>true</Ack>' in body
        assert 'xmlns="http://soap.sforce.com/2005/09/outbound"' in body
        assert 'notificationsResponse' in body
        assert '<soapenv:Envelope' in body

    def test_ack_false_xml_structure(self, sf_webhook_module):
        body = sf_webhook_module._build_ack(False)
        assert '<Ack>false</Ack>' in body
        assert 'notificationsResponse' in body


class TestSoapParse:
    def test_parses_valid_soap(self, sf_webhook_module):
        parsed = sf_webhook_module._parse_outbound_message(VALID_SOAP)
        assert parsed['organization_id'] == '00DAAAAAAAAAAAAAAA'
        assert len(parsed['notifications']) == 1
        notif = parsed['notifications'][0]
        assert notif['sobject_type'] == 'Account'
        assert notif['fields']['Id'] == '001AAAAAAAAAAAAAAA'
        assert notif['fields']['Name'] == 'Acme via OM'

    def test_missing_org_id_raises(self, sf_webhook_module):
        with pytest.raises(sf_webhook_module.WebhookParseError):
            sf_webhook_module._parse_outbound_message(SOAP_NO_ORG_ID)

    def test_tampered_xml_raises(self, sf_webhook_module):
        with pytest.raises(sf_webhook_module.WebhookParseError):
            sf_webhook_module._parse_outbound_message(TAMPERED_SOAP)


class TestWebhookValidOrgId:
    def test_valid_org_id_returns_ack_true_and_processes(
            self, sf_webhook_module, mock_conn):
        conn, _ = mock_conn
        with patch('sf_webhook.get_account_config',
                   return_value='00DAAAAAAAAAAAAAAA'), \
             patch('sf_webhook.set_account_config'), \
             patch('sf_webhook._reconcile_account') as mock_reconcile:
            event = {
                'queryStringParameters': {'account_id': '42'},
                'body': VALID_SOAP,
            }
            response = sf_webhook_module.handle_outbound_message(
                event, get_db_connection=lambda: conn
            )
            assert response['statusCode'] == 200
            assert '<Ack>true</Ack>' in response['body']
            mock_reconcile.assert_called_once()
            # The reconcile call receives our account_id (42) and the SF fields
            ra_args = mock_reconcile.call_args.args
            assert ra_args[1] == 42
            assert ra_args[2]['Id'] == '001AAAAAAAAAAAAAAA'


class TestWebhookWrongOrgId:
    def test_wrong_org_id_returns_ack_false_and_logs_spoof(
            self, sf_webhook_module, mock_conn):
        conn, cur = mock_conn
        # stored org_id is different from what SOAP claims
        with patch('sf_webhook.get_account_config',
                   return_value='00D_REAL_ORG_FOR_42'), \
             patch('sf_webhook._reconcile_account') as mock_reconcile:
            event = {
                'queryStringParameters': {'account_id': '42'},
                'body': VALID_SOAP,
            }
            response = sf_webhook_module.handle_outbound_message(
                event, get_db_connection=lambda: conn
            )
            assert '<Ack>false</Ack>' in response['body']
            mock_reconcile.assert_not_called()
            # Spoof attempt recorded
            spoof_log = [
                c for c in cur.execute.call_args_list
                if 'spoof' in c.args[0]
            ]
            assert len(spoof_log) == 1


class TestWebhookMissingAccountId:
    def test_no_account_id_returns_ack_false(self, sf_webhook_module, mock_conn):
        conn, _ = mock_conn
        event = {'queryStringParameters': {}, 'body': VALID_SOAP}
        response = sf_webhook_module.handle_outbound_message(
            event, get_db_connection=lambda: conn
        )
        assert '<Ack>false</Ack>' in response['body']


class TestWebhookMissingOrgIdInSoap:
    def test_returns_ack_false(self, sf_webhook_module, mock_conn):
        conn, _ = mock_conn
        event = {'queryStringParameters': {'account_id': '42'}, 'body': SOAP_NO_ORG_ID}
        response = sf_webhook_module.handle_outbound_message(
            event, get_db_connection=lambda: conn
        )
        assert '<Ack>false</Ack>' in response['body']


class TestWebhookTamperedBody:
    def test_returns_ack_false_does_not_raise(self, sf_webhook_module, mock_conn):
        conn, _ = mock_conn
        event = {'queryStringParameters': {'account_id': '42'}, 'body': TAMPERED_SOAP}
        response = sf_webhook_module.handle_outbound_message(
            event, get_db_connection=lambda: conn
        )
        assert response['statusCode'] == 200
        assert '<Ack>false</Ack>' in response['body']


class TestWebhookFirstTimeBootstrap:
    def test_first_call_fetches_org_id_then_verifies(
            self, sf_webhook_module, mock_conn):
        """No stored org_id yet → fetch from /oauth2/userinfo using account's
        tokens, persist, then verify against SOAP. Match → Ack=true."""
        conn, _ = mock_conn
        org_id_seq = iter([None])  # first lookup returns None
        with patch('sf_webhook.get_account_config',
                   side_effect=lambda c, aid, k: next(org_id_seq, None)), \
             patch('sf_webhook.read_account_tokens') as mock_read, \
             patch('sf_webhook.fetch_org_id', return_value='00DAAAAAAAAAAAAAAA') as mock_fetch, \
             patch('sf_webhook.set_account_config') as mock_set, \
             patch('sf_webhook._reconcile_account'):
            mock_read.return_value = {
                'access_token': 'AT', 'refresh_token': 'RT',
                'instance_url': 'https://acme.my.salesforce.com',
            }
            event = {'queryStringParameters': {'account_id': '42'}, 'body': VALID_SOAP}
            response = sf_webhook_module.handle_outbound_message(
                event, get_db_connection=lambda: conn
            )
            assert '<Ack>true</Ack>' in response['body']
            # Persisted the fetched org_id scoped to account_id=42
            stored = [c for c in mock_set.call_args_list
                      if c.args[2] == 'salesforce_org_id']
            assert len(stored) == 1
            assert stored[0].args[1] == 42
            assert stored[0].args[3] == '00DAAAAAAAAAAAAAAA'

    def test_first_call_with_no_tokens_returns_ack_false(
            self, sf_webhook_module, mock_conn):
        """Bootstrap can't proceed if the account never connected SF."""
        conn, _ = mock_conn
        with patch('sf_webhook.get_account_config', return_value=None), \
             patch('sf_webhook.read_account_tokens', return_value=None), \
             patch('sf_webhook._reconcile_account') as mock_reconcile:
            event = {'queryStringParameters': {'account_id': '42'}, 'body': VALID_SOAP}
            response = sf_webhook_module.handle_outbound_message(
                event, get_db_connection=lambda: conn
            )
            assert '<Ack>false</Ack>' in response['body']
            mock_reconcile.assert_not_called()


class TestWebhookCrossAccountSpoof:
    def test_url_account_id_must_match_stored_org_id(
            self, sf_webhook_module, mock_conn):
        """Attacker sends SF's real org_id 00D_REAL_B but to URL ?account_id=A.
        Account A's stored org_id is 00D_REAL_A (different), so rejected.
        This is the load-bearing tenant-isolation check on the webhook."""
        conn, cur = mock_conn
        # SOAP has org id 00DAAAAAAAAAAAAAAA, but account_id=42's stored is different
        with patch('sf_webhook.get_account_config',
                   return_value='00D_BELONGS_TO_DIFFERENT_ACCOUNT'), \
             patch('sf_webhook._reconcile_account') as mock_reconcile:
            event = {'queryStringParameters': {'account_id': '42'}, 'body': VALID_SOAP}
            response = sf_webhook_module.handle_outbound_message(
                event, get_db_connection=lambda: conn
            )
            assert '<Ack>false</Ack>' in response['body']
            mock_reconcile.assert_not_called()
            # Spoof logged scoped to account_id=42
            spoof_log = [c for c in cur.execute.call_args_list
                         if 'spoof' in c.args[0]]
            assert len(spoof_log) == 1
            assert spoof_log[0].args[1][0] == 42  # account_id parameter
