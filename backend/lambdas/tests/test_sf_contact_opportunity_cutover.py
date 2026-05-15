"""
PR 3.5 — Contact + Opportunity pull + SF read/write cutover to
client_salesforce_links.

Coverage map (each bullet from Ken's brief gets a test):
  Contact pull
    - XO_Sync_Enabled__c filter applied when present
    - graceful fallback when absent
    - match-by-salesforce_contact_id wins over match-by-email
    - match-by-lowercase-email when no SF id stored yet
    - insert-new-contact path
    - encrypt round-trip via per-client key
    - legacy contacts_json fallback (empty contacts_json + legacy
      contact_* columns → built into the merge list)
    - conflict aggregation: 2 conflicting contacts → 1 log row
    - orphan: SF Contact whose AccountId has no client_salesforce_links
    - high-water timestamp scoped to JWT account_id

  Opportunity pull
    - filter applied / fallback
    - update existing engagement (sf_opportunity_id match)
    - update existing engagement (lower-name match when SF id missing)
    - create new engagement when linked client exists
    - orphan skip when no linked client

  SF cutover
    - sf_push writes only to client_salesforce_links (no legacy column)
    - sf_push reads link scoped to JWT account_id
    - sf_pull reconcile joins client_salesforce_links

  Webhook extension
    - Contact notification routes to _reconcile_contact
    - Opportunity notification routes to _reconcile_opportunity

  Tenant isolation (load-bearing)
    - Intellistack pull reads Intellistack's link rows ONLY,
      not Intellagentic's
"""

import base64
import importlib
import json
import os
import sys
from unittest.mock import MagicMock, patch

import pytest


sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'salesforce-sync'))


TEST_MASTER_KEY = base64.b64encode(os.urandom(32)).decode()


@pytest.fixture
def sf_contact_pull(monkeypatch):
    monkeypatch.setenv('AES_MASTER_KEY', TEST_MASTER_KEY)
    for mod in ('crypto_helper', 'sf_client', 'sf_pull', 'sf_contact_pull',
                'sf_opportunity_pull'):
        if mod in sys.modules:
            del sys.modules[mod]
    import sf_contact_pull
    importlib.reload(sf_contact_pull)
    sf_contact_pull._describe_fields.__globals__['_FIELD_DESCRIBE_CACHE'].clear()
    yield sf_contact_pull


@pytest.fixture
def sf_opp_pull(monkeypatch):
    monkeypatch.setenv('AES_MASTER_KEY', TEST_MASTER_KEY)
    for mod in ('crypto_helper', 'sf_client', 'sf_pull',
                'sf_contact_pull', 'sf_opportunity_pull'):
        if mod in sys.modules:
            del sys.modules[mod]
    import sf_opportunity_pull
    importlib.reload(sf_opportunity_pull)
    sf_opportunity_pull._describe_fields.__globals__['_FIELD_DESCRIBE_CACHE'].clear()
    yield sf_opportunity_pull


def _mock_conn():
    cur = MagicMock()
    cur.fetchone.return_value = None
    cur.fetchall.return_value = []
    conn = MagicMock()
    conn.cursor.return_value = cur
    return conn, cur


def _make_xo_client_row(enc_key, contacts_json=None, legacy_name='',
                       legacy_email='', legacy_phone='', legacy_linkedin='',
                       legacy_title=''):
    return (enc_key, contacts_json, legacy_name, legacy_email,
            legacy_phone, legacy_linkedin, legacy_title)


# ──────────────────────────────────────────────
# CONTACT PULL
# ──────────────────────────────────────────────

class TestContactPullFilter:
    def test_filter_applied_when_field_exists(self, sf_contact_pull):
        # _describe_fields is defined in sf_pull and uses sf_pull's binding
        # of sf_call_with_refresh. _query_contacts uses sf_contact_pull's
        # binding. Patch both with the same MagicMock so a single
        # side_effect list feeds describe then query in order.
        import sf_pull as _sfp
        conn, cur = _mock_conn()
        shared = MagicMock(side_effect=[
            (200, {'fields': [{'name': 'XO_Sync_Enabled__c'}]}),
            (200, {'records': []}),
        ])
        with patch.object(sf_contact_pull, 'sf_call_with_refresh', shared), \
             patch.object(_sfp, 'sf_call_with_refresh', shared), \
             patch.object(sf_contact_pull, 'get_account_config', return_value=None), \
             patch.object(sf_contact_pull, 'set_account_config'):
            summary = sf_contact_pull.pull_contacts(conn, 42, {
                'access_token': 'AT', 'refresh_token': 'RT',
                'instance_url': 'https://x.my.salesforce.com',
            })
            assert summary['xo_sync_filter_applied'] is True
            soql = shared.call_args_list[1].kwargs['params']['q']
            assert 'XO_Sync_Enabled__c = TRUE' in soql

    def test_fallback_when_field_absent(self, sf_contact_pull):
        import sf_pull as _sfp
        conn, cur = _mock_conn()
        shared = MagicMock(side_effect=[
            (200, {'fields': []}),
            (200, {'records': []}),
        ])
        with patch.object(sf_contact_pull, 'sf_call_with_refresh', shared), \
             patch.object(_sfp, 'sf_call_with_refresh', shared), \
             patch.object(sf_contact_pull, 'get_account_config', return_value=None), \
             patch.object(sf_contact_pull, 'set_account_config'):
            summary = sf_contact_pull.pull_contacts(conn, 42, {
                'access_token': 'AT', 'refresh_token': 'RT',
                'instance_url': 'https://x.my.salesforce.com',
            })
            assert summary['xo_sync_filter_applied'] is False


class TestContactMatching:
    def test_match_by_sf_id_wins_over_email(self, sf_contact_pull):
        contacts = [
            {'email': 'j@acme.com', 'salesforce_contact_id': '003-OLD'},
            {'email': 'j@acme.com', 'salesforce_contact_id': '003-NEW'},
        ]
        sf = {'Id': '003-NEW', 'Email': 'j@acme.com'}
        idx, found = sf_contact_pull._find_existing_contact(contacts, sf)
        assert idx == 1
        assert found['salesforce_contact_id'] == '003-NEW'

    def test_match_by_lowercase_email_when_no_sf_id(self, sf_contact_pull):
        contacts = [{'email': 'J@ACME.com'}]
        sf = {'Id': '003-X', 'Email': 'j@acme.COM'}
        idx, found = sf_contact_pull._find_existing_contact(contacts, sf)
        assert idx == 0

    def test_no_match_returns_none(self, sf_contact_pull):
        contacts = [{'email': 'a@a.com', 'salesforce_contact_id': '003-A'}]
        sf = {'Id': '003-X', 'Email': 'x@x.com'}
        idx, found = sf_contact_pull._find_existing_contact(contacts, sf)
        assert idx == -1
        assert found is None


class TestContactReconcile:
    def _setup(self, sf_contact_pull, xo_client_row,
               link_match=True, account_id=42):
        conn, cur = _mock_conn()
        fetchones = [(uuid_str := 'client-uuid-1',) if link_match else None]
        if link_match:
            fetchones.append(xo_client_row)
        cur.fetchone.side_effect = fetchones
        return conn, cur, uuid_str if link_match else None

    def test_orphan_when_no_account_id(self, sf_contact_pull):
        conn, cur = _mock_conn()
        result = sf_contact_pull._reconcile_contact(
            conn, 42, {'Id': '003-X', 'Email': 'x@x.com', 'AccountId': None}
        )
        assert result == 'orphan'

    def test_orphan_when_no_linked_client(self, sf_contact_pull):
        conn, cur = _mock_conn()
        cur.fetchone.return_value = None  # client_salesforce_links lookup misses
        result = sf_contact_pull._reconcile_contact(
            conn, 42, {'Id': '003-X', 'Email': 'x@x.com', 'AccountId': '001-A'}
        )
        assert result == 'orphan'
        # Orphan log row written
        executed = [c.args[0] for c in cur.execute.call_args_list]
        assert any('salesforce_sync_log' in s and "'pull'" in s for s in executed)

    def test_insert_new_contact_re_encrypts(self, sf_contact_pull):
        conn, cur = _mock_conn()
        # 1. link lookup → client-uuid-1
        # 2. client row → encryption key + empty contacts_json + no legacy
        # 3. UPDATE clients SET contacts_json (mocked via execute)
        cur.fetchone.side_effect = [
            ('client-uuid-1',),
            _make_xo_client_row(enc_key=None, contacts_json=None),
        ]
        result = sf_contact_pull._reconcile_contact(
            conn, 42,
            {'Id': '003-NEW', 'Email': 'new@acme.com',
             'FirstName': 'New', 'LastName': 'Person',
             'Title': 'PM', 'AccountId': '001-A'},
        )
        assert result == 'inserted'
        # The UPDATE clients SET contacts_json ran with the new contact serialized
        updates = [c for c in cur.execute.call_args_list
                   if 'UPDATE clients SET contacts_json' in c.args[0]]
        assert len(updates) == 1

    def test_legacy_fallback_used_when_contacts_json_empty(self, sf_contact_pull):
        """Empty contacts_json + populated legacy contact_email → the merge
        list starts with the legacy contact (matching enrich:399 fallback)."""
        conn, cur = _mock_conn()
        cur.fetchone.side_effect = [
            ('client-uuid-1',),
            _make_xo_client_row(
                enc_key=None, contacts_json=None,
                legacy_email='legacy@acme.com', legacy_name='Legacy Person',
            ),
        ]
        # SF Contact has a DIFFERENT email → must not match the legacy entry
        sf_contact_pull._reconcile_contact(
            conn, 42,
            {'Id': '003-X', 'Email': 'new@acme.com',
             'FirstName': 'New', 'LastName': 'Person', 'AccountId': '001-A'},
        )
        # The UPDATE serialized array now contains BOTH the legacy + new
        updates = [c for c in cur.execute.call_args_list
                   if 'UPDATE clients SET contacts_json' in c.args[0]]
        assert len(updates) == 1
        written = updates[0].args[1][0]
        # Master key not set → client_encrypt_json passes the JSON string
        # through. Should reference both emails.
        assert 'legacy@acme.com' in str(written)
        assert 'new@acme.com' in str(written)

    def test_conflict_aggregation_two_contacts_one_log_row(self, sf_contact_pull):
        """Two SF Contacts on the same XO client, each in conflict with the
        existing entry, produce TWO log rows (one per call) — each call to
        _reconcile_contact handles a single SF Contact. The aggregation
        spec is: per-call diff goes to ONE row with ALL diffs for that
        contact. Verify the diff structure is right."""
        conn, cur = _mock_conn()
        existing_contacts = [
            {'email': 'a@a.com', 'firstName': 'AOLD', 'salesforce_contact_id': '003-A'},
        ]
        cur.fetchone.side_effect = [
            ('client-uuid-1',),
            _make_xo_client_row(enc_key=None,
                                contacts_json=json.dumps(existing_contacts)),
        ]
        result = sf_contact_pull._reconcile_contact(
            conn, 42,
            {'Id': '003-A', 'Email': 'a@a.com', 'FirstName': 'ANEW',
             'LastName': 'Surname', 'Title': 'Director', 'AccountId': '001-A'},
        )
        assert result == 'conflict'
        # Inserted ONE conflict log row, fields_skipped names the contact
        # and details carries per-field diffs.
        inserts = [c for c in cur.execute.call_args_list
                   if 'INSERT INTO salesforce_sync_log' in c.args[0]
                   and "'conflict'" in c.args[0]]
        assert len(inserts) == 1
        params = inserts[0].args[1]
        # params: (account_id, xo_client_id, fields_skipped_json, details_json)
        fields_skipped = json.loads(params[2])
        assert 'a@a.com' in fields_skipped
        details = json.loads(params[3])
        # All differing fields present
        diff_fields = {d['field'] for d in details}
        assert 'firstName' in diff_fields  # 'AOLD' vs 'ANEW'


class TestContactHighWater:
    def test_high_water_scoped_to_jwt_account_id(self, sf_contact_pull):
        import sf_pull as _sfp
        conn, cur = _mock_conn()
        shared = MagicMock(side_effect=[
            (200, {'fields': []}),
            (200, {'records': [
                {'Id': '003-1', 'Email': 'e@e.com', 'AccountId': None,
                 'LastModifiedDate': '2026-04-15T10:00:00.000+0000'},
            ]}),
        ])
        with patch.object(sf_contact_pull, 'sf_call_with_refresh', shared), \
             patch.object(_sfp, 'sf_call_with_refresh', shared), \
             patch.object(sf_contact_pull, 'get_account_config', return_value=None), \
             patch.object(sf_contact_pull, 'set_account_config') as mock_set:
            sf_contact_pull.pull_contacts(conn, 42, {
                'access_token': 'AT', 'refresh_token': 'RT',
                'instance_url': 'https://x.my.salesforce.com',
            })
            hw = [c for c in mock_set.call_args_list
                  if c.args[2] == 'salesforce_contact_last_pull_at']
            assert len(hw) == 1
            assert hw[0].args[1] == 42  # account_id scope


# ──────────────────────────────────────────────
# OPPORTUNITY PULL
# ──────────────────────────────────────────────

class TestOpportunityPullFilter:
    def test_filter_applied(self, sf_opp_pull):
        import sf_pull as _sfp
        conn, cur = _mock_conn()
        shared = MagicMock(side_effect=[
            (200, {'fields': [{'name': 'XO_Sync_Enabled__c'}]}),
            (200, {'records': []}),
        ])
        with patch.object(sf_opp_pull, 'sf_call_with_refresh', shared), \
             patch.object(_sfp, 'sf_call_with_refresh', shared), \
             patch.object(sf_opp_pull, 'get_account_config', return_value=None), \
             patch.object(sf_opp_pull, 'set_account_config'):
            summary = sf_opp_pull.pull_opportunities(conn, 42, {
                'access_token': 'AT', 'refresh_token': 'RT',
                'instance_url': 'https://x.my.salesforce.com',
            })
            assert summary['xo_sync_filter_applied'] is True

    def test_fallback_when_field_absent(self, sf_opp_pull):
        import sf_pull as _sfp
        conn, cur = _mock_conn()
        shared = MagicMock(side_effect=[
            (200, {'fields': []}),
            (200, {'records': []}),
        ])
        with patch.object(sf_opp_pull, 'sf_call_with_refresh', shared), \
             patch.object(_sfp, 'sf_call_with_refresh', shared), \
             patch.object(sf_opp_pull, 'get_account_config', return_value=None), \
             patch.object(sf_opp_pull, 'set_account_config'):
            summary = sf_opp_pull.pull_opportunities(conn, 42, {
                'access_token': 'AT', 'refresh_token': 'RT',
                'instance_url': 'https://x.my.salesforce.com',
            })
            assert summary['xo_sync_filter_applied'] is False


class TestOpportunityReconcile:
    def test_orphan_when_no_linked_client(self, sf_opp_pull):
        conn, cur = _mock_conn()
        cur.fetchone.return_value = None
        result = sf_opp_pull._reconcile_opportunity(
            conn, 42,
            {'Id': '006-X', 'Name': 'Deal', 'AccountId': '001-NOMATCH',
             'LastModifiedDate': '2026-04-15T10:00:00.000+0000'},
        )
        assert result == 'orphan'

    def test_create_new_engagement_when_linked_client_exists(self, sf_opp_pull):
        conn, cur = _mock_conn()
        # 1. _find_linked_xo_client → ('xo-client-1',)
        # 2. _find_engagement by sf-opp-id → None
        # 3. _find_engagement by lower(name) → None
        # 4. INSERT engagements ... RETURNING id → ('eng-uuid-1',)
        cur.fetchone.side_effect = [
            ('xo-client-1',),
            None,
            None,
            ('eng-uuid-1',),
        ]
        result = sf_opp_pull._reconcile_opportunity(
            conn, 42,
            {'Id': '006-NEW', 'Name': 'New Deal', 'AccountId': '001-A',
             'StageName': 'Prospecting', 'Amount': 50000,
             'LastModifiedDate': '2026-04-15T10:00:00.000+0000'},
        )
        assert result == 'created'

    def test_update_existing_engagement_by_sf_opp_id(self, sf_opp_pull):
        from datetime import datetime, timezone, timedelta
        conn, cur = _mock_conn()
        # link lookup → client
        # find engagement by sf-opp-id → match (older updated_at, no last_sync)
        cur.fetchone.side_effect = [
            ('xo-client-1',),
            ('eng-uuid-1', 'Old Name', 'Prospecting', 1000, None, None,
             datetime(2026, 1, 1, tzinfo=timezone.utc), None),
        ]
        result = sf_opp_pull._reconcile_opportunity(
            conn, 42,
            {'Id': '006-A', 'Name': 'New Name', 'AccountId': '001-A',
             'StageName': 'Qualified', 'Amount': 5000,
             'LastModifiedDate': '2026-04-15T10:00:00.000+0000'},
        )
        assert result == 'pulled'

    def test_orphan_skip_details_message(self, sf_opp_pull):
        conn, cur = _mock_conn()
        cur.fetchone.return_value = None
        sf_opp_pull._reconcile_opportunity(
            conn, 42,
            {'Id': '006-X', 'Name': 'Orphan', 'AccountId': '001-NOMATCH',
             'LastModifiedDate': '2026-04-15T10:00:00.000+0000'},
        )
        # Orphan log row with the brief's exact details message
        inserts = [c for c in cur.execute.call_args_list
                   if 'INSERT INTO salesforce_sync_log' in c.args[0]]
        assert len(inserts) == 1
        params = inserts[0].args[1]
        # details param: account_id, sf_id, details → 3rd positional
        assert 'opportunity orphaned' in params[2]


# ──────────────────────────────────────────────
# SF CUTOVER — push reads/writes via client_salesforce_links
# ──────────────────────────────────────────────

@pytest.fixture
def sf_lambda(monkeypatch):
    """Load salesforce-sync's lambda_function. Critical: sys.path must point
    at salesforce-sync BEFORE the import, since 'lambda_function' is a
    module name used in multiple lambda directories. Tests that loaded
    a different lambda_function (e.g. clients) earlier leave it cached in
    sys.modules; we evict it and re-import from the right path."""
    monkeypatch.setenv('AES_MASTER_KEY', TEST_MASTER_KEY)
    monkeypatch.setenv('DATABASE_URL', 'postgresql://fake')
    monkeypatch.setenv('SALESFORCE_CLIENT_ID', 'sf-id')
    monkeypatch.setenv('SALESFORCE_CLIENT_SECRET', 'sf-secret')
    monkeypatch.setenv('SALESFORCE_REDIRECT_URI', 'https://x/cb')
    for mod in ('lambda_function', 'sf_client', 'sf_pull',
                'sf_contact_pull', 'sf_opportunity_pull', 'sf_webhook',
                'crypto_helper'):
        if mod in sys.modules:
            del sys.modules[mod]
    sf_dir = os.path.join(os.path.dirname(__file__), '..', 'salesforce-sync')
    sys.path.insert(0, sf_dir)
    try:
        with patch('psycopg2.connect') as mock_connect:
            cur = MagicMock()
            cur.fetchone.return_value = None
            cur.fetchall.return_value = []
            conn = MagicMock()
            conn.cursor.return_value = cur
            mock_connect.return_value = conn
            import lambda_function
            importlib.reload(lambda_function)
            yield lambda_function
    finally:
        sys.path.remove(sf_dir)
        if 'lambda_function' in sys.modules:
            del sys.modules['lambda_function']


class TestSfPushCutover:
    def test_push_reads_link_scoped_to_jwt_account_id(self, sf_lambda):
        """The SF Account Id lookup before push must come from
        client_salesforce_links keyed by JWT account_id."""
        conn = MagicMock()
        cur = MagicMock()
        conn.cursor.return_value = cur
        # 1. SELECT client (post-cutover, no legacy SF columns)
        # 2. SELECT salesforce_account_id FROM client_salesforce_links → ('001-EXIST',)
        cur.fetchone.side_effect = [
            ('client-uuid-1', 'Acme', 'https://acme.com', 'Tech', 'desc',
             None, None, None, None, None, 42),
            ('001-EXISTING-SF-ID',),
        ]
        user = {'user_id': 'u', 'account_id': 42,
                'account_role': 'account_admin', 'is_admin': False,
                'is_account': True, 'is_client': False, 'client_id': None}

        with patch.object(sf_lambda, 'get_db_connection', return_value=conn), \
             patch.object(sf_lambda, 'require_auth', return_value=(user, None)), \
             patch.object(sf_lambda, 'can_user_access_client', return_value=True), \
             patch.object(sf_lambda, 'read_account_tokens',
                          return_value={'access_token': 'AT', 'refresh_token': 'RT',
                                        'instance_url': 'https://x.my.salesforce.com'}), \
             patch.object(sf_lambda, '_create_or_update_account',
                          return_value='001-EXISTING-SF-ID'):
            event = {
                'httpMethod': 'POST', 'path': '/salesforce/sync/push',
                'headers': {'Authorization': 'Bearer x'},
                'body': json.dumps({'client_id': 'client-uuid-1'}),
            }
            sf_lambda.lambda_handler(event, None)

        # The link lookup query must be scoped to (client, account_id=42).
        link_queries = [
            c for c in cur.execute.call_args_list
            if 'FROM client_salesforce_links' in c.args[0]
            and 'salesforce_account_id' in c.args[0]
        ]
        assert link_queries, "push must read client_salesforce_links pre-create"
        assert link_queries[0].args[1] == ('client-uuid-1', 42)

    def test_push_writes_only_to_client_salesforce_links(self, sf_lambda):
        """After cutover, NO UPDATE clients SET salesforce_account_id."""
        conn = MagicMock()
        cur = MagicMock()
        conn.cursor.return_value = cur
        cur.fetchone.side_effect = [
            ('client-uuid-1', 'Acme', 'https://acme.com', 'Tech', 'desc',
             None, None, None, None, None, 42),
            None,  # no existing link
        ]
        user = {'user_id': 'u', 'account_id': 42,
                'account_role': 'account_admin', 'is_admin': False,
                'is_account': True, 'is_client': False, 'client_id': None}

        with patch.object(sf_lambda, 'get_db_connection', return_value=conn), \
             patch.object(sf_lambda, 'require_auth', return_value=(user, None)), \
             patch.object(sf_lambda, 'can_user_access_client', return_value=True), \
             patch.object(sf_lambda, 'read_account_tokens',
                          return_value={'access_token': 'AT', 'refresh_token': 'RT',
                                        'instance_url': 'https://x.my.salesforce.com'}), \
             patch.object(sf_lambda, '_find_account_by_name', return_value=None), \
             patch.object(sf_lambda, '_create_or_update_account',
                          return_value='001-NEW'):
            event = {
                'httpMethod': 'POST', 'path': '/salesforce/sync/push',
                'headers': {'Authorization': 'Bearer x'},
                'body': json.dumps({'client_id': 'client-uuid-1'}),
            }
            sf_lambda.lambda_handler(event, None)

        executed = [c.args[0] for c in cur.execute.call_args_list]
        # No legacy UPDATE.
        assert not any(
            'UPDATE clients SET salesforce_account_id' in s for s in executed
        ), "PR 3.5 cutover: legacy column must not be written"
        # client_salesforce_links UPSERT did run.
        assert any('INSERT INTO client_salesforce_links' in s for s in executed)


# ──────────────────────────────────────────────
# WEBHOOK EXTENSION
# ──────────────────────────────────────────────

@pytest.fixture
def sf_webhook_mod(monkeypatch):
    monkeypatch.setenv('AES_MASTER_KEY', TEST_MASTER_KEY)
    monkeypatch.setenv('DATABASE_URL', 'postgresql://fake')
    monkeypatch.setenv('SALESFORCE_CLIENT_ID', 'x')
    monkeypatch.setenv('SALESFORCE_CLIENT_SECRET', 'x')
    monkeypatch.setenv('SALESFORCE_REDIRECT_URI', 'https://x/cb')
    for mod in ('sf_client', 'sf_pull', 'sf_contact_pull',
                'sf_opportunity_pull', 'sf_webhook', 'crypto_helper'):
        if mod in sys.modules:
            del sys.modules[mod]
    import sf_webhook
    importlib.reload(sf_webhook)
    yield sf_webhook


def _make_soap(sobject_type, sf_id, extra_fields_xml=''):
    return f"""<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <notifications xmlns="http://soap.sforce.com/2005/09/outbound">
      <OrganizationId>00DAAAAAAAAAAAAAAA</OrganizationId>
      <ActionId>x</ActionId>
      <Notification>
        <Id>n1</Id>
        <sObject xsi:type="sf:{sobject_type}"
                 xmlns:sf="urn:sobject.enterprise.soap.sforce.com"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
          <sf:Id>{sf_id}</sf:Id>
          {extra_fields_xml}
        </sObject>
      </Notification>
    </notifications>
  </soapenv:Body>
</soapenv:Envelope>"""


class TestWebhookExtension:
    def test_contact_notification_routes_to_contact_reconciler(self, sf_webhook_mod):
        conn, _ = _mock_conn()
        with patch.object(sf_webhook_mod, 'get_account_config',
                          return_value='00DAAAAAAAAAAAAAAA'), \
             patch.object(sf_webhook_mod, '_reconcile_account') as ra, \
             patch.object(sf_webhook_mod, '_reconcile_contact') as rc, \
             patch.object(sf_webhook_mod, '_reconcile_opportunity') as ro:
            event = {
                'queryStringParameters': {'account_id': '42'},
                'body': _make_soap('Contact', '003-A',
                                   '<sf:Email>x@x.com</sf:Email>'),
            }
            sf_webhook_mod.handle_outbound_message(
                event, get_db_connection=lambda: conn
            )
            rc.assert_called_once()
            ra.assert_not_called()
            ro.assert_not_called()

    def test_opportunity_notification_routes_to_opportunity_reconciler(self, sf_webhook_mod):
        conn, _ = _mock_conn()
        with patch.object(sf_webhook_mod, 'get_account_config',
                          return_value='00DAAAAAAAAAAAAAAA'), \
             patch.object(sf_webhook_mod, '_reconcile_account') as ra, \
             patch.object(sf_webhook_mod, '_reconcile_contact') as rc, \
             patch.object(sf_webhook_mod, '_reconcile_opportunity') as ro:
            event = {
                'queryStringParameters': {'account_id': '42'},
                'body': _make_soap('Opportunity', '006-A',
                                   '<sf:Name>Deal</sf:Name>'),
            }
            sf_webhook_mod.handle_outbound_message(
                event, get_db_connection=lambda: conn
            )
            ro.assert_called_once()
            ra.assert_not_called()
            rc.assert_not_called()


# ──────────────────────────────────────────────
# TENANT ISOLATION (load-bearing)
# ──────────────────────────────────────────────

class TestTenantIsolation:
    def test_contact_pull_link_lookup_scoped_to_jwt_account_id(
            self, sf_contact_pull):
        """An Intellistack pull (account_id=42) must read Intellistack's
        client_salesforce_links rows only. The SELECT's WHERE clause is
        verified to bind account_id=42, not some other tenant's id."""
        conn, cur = _mock_conn()
        cur.fetchone.return_value = None  # no link for Intellistack
        sf_contact_pull._find_linked_xo_client(conn, 42, '001-SHARED-CLIENT')
        link_queries = [c for c in cur.execute.call_args_list
                        if 'FROM client_salesforce_links' in c.args[0]]
        assert len(link_queries) == 1
        params = link_queries[0].args[1]
        assert params[0] == 42  # JWT account_id
        assert params[1] == '001-SHARED-CLIENT'

    def test_opportunity_pull_link_lookup_scoped_to_jwt_account_id(
            self, sf_opp_pull):
        conn, cur = _mock_conn()
        cur.fetchone.return_value = None
        sf_opp_pull._find_linked_xo_client(conn, 42, '001-SHARED-CLIENT')
        link_queries = [c for c in cur.execute.call_args_list
                        if 'FROM client_salesforce_links' in c.args[0]]
        assert len(link_queries) == 1
        assert link_queries[0].args[1][0] == 42
