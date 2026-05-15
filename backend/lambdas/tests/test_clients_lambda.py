"""
Regression tests for clients/lambda_function.py
"""

import os
import sys
import json
import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'clients'))

from test_helpers import (
    make_event, make_authed_event, assert_status, parse_body,
    ADMIN_USER, PARTNER_USER, CLIENT_USER, REGULAR_USER,
    SUPER_ADMIN_USER, ACCOUNT_ADMIN_USER, ACCOUNT_USER, CLIENT_CONTACT_USER,
)


@pytest.fixture
def mock_deps():
    """Mock DB, S3, and auth for clients lambda."""
    mock_cur = MagicMock()
    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cur
    mock_cur.fetchone.return_value = None
    mock_cur.fetchall.return_value = []

    mock_s3 = MagicMock()

    patches = {
        'get_db_connection': patch('lambda_function.get_db_connection', return_value=mock_conn),
        'require_auth': patch('lambda_function.require_auth'),
        's3_client': patch('lambda_function.s3_client', mock_s3),
        # PR 3.4: patch the helper so role-specific SQL inspection tests
        # don't depend on the helper's own DB lookups (account_id + UCA
        # subqueries) inflating the fetchone sequence.
        'can_user_access_client': patch('lambda_function.can_user_access_client',
                                        return_value=True),
    }
    started = {k: p.start() for k, p in patches.items()}
    yield started, mock_conn, mock_cur, mock_s3
    for p in patches.values():
        p.stop()


@pytest.fixture
def clients_module():
    """Import clients lambda."""
    with patch.dict(os.environ, {
        'DATABASE_URL': 'postgresql://fake',
        'JWT_SECRET': 'test-secret',
        'BUCKET_NAME': 'test-bucket',
    }):
        with patch('psycopg2.connect') as mock_connect:
            mock_cur = MagicMock()
            mock_cur.fetchone.return_value = None
            mock_cur.fetchall.return_value = []
            mock_conn = MagicMock()
            mock_conn.cursor.return_value = mock_cur
            mock_connect.return_value = mock_conn

            import importlib
            if 'lambda_function' in sys.modules:
                del sys.modules['lambda_function']
            clients_dir = os.path.join(os.path.dirname(__file__), '..', 'clients')
            sys.path.insert(0, clients_dir)
            try:
                import lambda_function
                importlib.reload(lambda_function)
                yield lambda_function
            finally:
                sys.path.remove(clients_dir)
                if 'lambda_function' in sys.modules:
                    del sys.modules['lambda_function']


class TestOptionsHandler:
    def test_options_returns_200(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        event = make_event(method='OPTIONS', path='/clients')
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 200)


class TestCreateClient:
    def test_missing_company_name_returns_400(self, clients_module, mock_deps):
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)
        mock_cur.fetchone.return_value = ('db-id-1',)

        event = make_event(method='POST', path='/clients', body={
            'website': 'https://test.com'
        })
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 400)
        assert 'company_name' in parse_body(response)['error']

    def test_client_user_cannot_create_client(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (CLIENT_USER, None)

        event = make_event(method='POST', path='/clients', body={
            'company_name': 'Test Corp'
        })
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 403)

    def test_client_contact_cannot_create_client(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (CLIENT_CONTACT_USER, None)

        event = make_event(method='POST', path='/clients', body={
            'company_name': 'Test Corp'
        })
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 403)

    def test_account_user_can_create_client_jwt_realistic(self, clients_module, mock_deps):
        """REGRESSION GUARD: real account_user JWTs carry is_client=True (because
        users.role='client'). They distinguish from legacy token-scoped users by
        the absence of a client_id claim. The route gate must NOT block this user.
        """
        started, _, mock_cur, _ = mock_deps
        # Build a JWT-realistic user dict, asserting our assumption explicitly.
        user = ACCOUNT_USER.copy()
        assert user['is_client'] is True, \
            "ACCOUNT_USER fixture must carry is_client=True to match real JWT shape"
        assert user['client_id'] is None, \
            "ACCOUNT_USER fixture must NOT have client_id (only legacy tokens do)"
        assert user['account_role'] == 'account_user'
        started['require_auth'].return_value = (user, None)
        mock_cur.fetchone.side_effect = [(None,), ('new-db-id',)]

        event = make_event(method='POST', path='/clients', body={
            'company_name': 'Test Corp'
        })
        response = clients_module.lambda_handler(event, None)
        assert response['statusCode'] != 403, \
            f"account_user POST must not 403; got {response['statusCode']}: {parse_body(response)}"

    def test_account_admin_can_create_client(self, clients_module, mock_deps):
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        mock_cur.fetchone.side_effect = [(None,), ('new-db-id',)]

        event = make_event(method='POST', path='/clients', body={
            'company_name': 'Test Corp'
        })
        response = clients_module.lambda_handler(event, None)
        assert response['statusCode'] != 403, parse_body(response)

    def test_create_inserts_uca_for_creator(self, clients_module, mock_deps):
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_USER, None)
        mock_cur.fetchone.side_effect = [(None,), ('new-db-id',)]

        event = make_event(method='POST', path='/clients', body={
            'company_name': 'Test Corp'
        })
        clients_module.lambda_handler(event, None)
        executed_sql = [c.args[0] for c in mock_cur.execute.call_args_list]
        uca_inserts = [s for s in executed_sql if 'INSERT INTO user_client_assignments' in s]
        assert uca_inserts, f"expected a UCA INSERT, got: {executed_sql}"
        uca_call = next(c for c in mock_cur.execute.call_args_list
                        if 'INSERT INTO user_client_assignments' in c.args[0])
        assert uca_call.args[1][0] == ACCOUNT_USER['user_id']
        assert uca_call.args[1][1] == 'new-db-id'


class TestGetClient:
    def test_get_client_not_found(self, clients_module, mock_deps):
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)
        mock_cur.fetchone.return_value = None

        event = make_event(method='GET', path='/clients',
                           query_params={'client_id': 'nonexistent'})
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 404)

    def test_client_user_forced_to_own_client(self, clients_module, mock_deps):
        started, _, mock_cur, _ = mock_deps
        user = CLIENT_USER.copy()
        started['require_auth'].return_value = (user, None)
        mock_cur.fetchone.return_value = None

        event = make_event(method='GET', path='/clients',
                           query_params={'client_id': 'other_client'})
        response = clients_module.lambda_handler(event, None)
        # Should force client_id to user's own client
        assert_status(response, 404)

    def test_account_user_get_client_uses_uca_predicate(self, clients_module, mock_deps):
        """account_user fetching by client_id must hit a query that joins UCA."""
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_USER, None)
        mock_cur.fetchone.return_value = None

        event = make_event(method='GET', path='/clients',
                           query_params={'client_id': 'client_xyz'})
        clients_module.lambda_handler(event, None)
        executed_sql = [c.args[0] for c in mock_cur.execute.call_args_list]
        select_sql = [s for s in executed_sql if 'SELECT' in s and 'FROM clients' in s]
        assert select_sql, f"expected a clients SELECT, got: {executed_sql}"
        assert any('user_client_assignments' in s for s in select_sql), \
            f"account_user GET should hit UCA predicate; got: {select_sql}"

    def test_account_admin_get_client_uses_account_id_predicate(self, clients_module, mock_deps):
        """account_admin fetching by client_id must filter by account_id, not user_id."""
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        mock_cur.fetchone.return_value = None

        event = make_event(method='GET', path='/clients',
                           query_params={'client_id': 'client_xyz'})
        clients_module.lambda_handler(event, None)
        executed_sql = [c.args[0] for c in mock_cur.execute.call_args_list]
        select_sql = [s for s in executed_sql if 'SELECT' in s and 'FROM clients' in s]
        assert select_sql
        chosen = select_sql[-1]
        assert 'account_id = %s' in chosen and 'user_id = %s' not in chosen, \
            f"account_admin GET should filter by account_id, got: {chosen}"


class TestUpdateClient:
    def test_missing_client_id_returns_400(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)

        event = make_event(method='PUT', path='/clients', body={
            'company_name': 'Test Corp'
        })
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 400)

    def test_missing_company_name_returns_400(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)

        event = make_event(method='PUT', path='/clients', body={
            'client_id': 'c123'
        })
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 400)

    def test_account_user_update_uses_uca_predicate(self, clients_module, mock_deps):
        """PR 3.4: WHERE is produced by clients_where_fragment. For
        account_user the fragment is a UCA subquery."""
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_USER, None)
        # _get_client_key fetchone + pre-check fetchone + UPDATE RETURNING.
        # can_user_access_client is patched True so its internal queries
        # don't run.
        mock_cur.fetchone.side_effect = [(None,), ('row-id',), ('row-id',)]

        event = make_event(method='PUT', path='/clients', body={
            'client_id': 'c123',
            'company_name': 'Test Corp'
        })
        clients_module.lambda_handler(event, None)
        executed_sql = [c.args[0] for c in mock_cur.execute.call_args_list]
        update_sql = [s for s in executed_sql if s.lstrip().startswith('UPDATE clients')]
        assert update_sql, f"expected UPDATE clients, got: {executed_sql}"
        assert any('user_client_assignments' in s for s in update_sql), \
            f"account_user UPDATE should reference UCA; got: {update_sql}"

    def test_account_admin_update_uses_account_id_predicate(self, clients_module, mock_deps):
        """PR 3.4: account_admin fragment is owned-OR-shared. The OR
        clause references client_shares. account_id is still bound."""
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        # _get_client_key + pre-check + UPDATE RETURNING.
        mock_cur.fetchone.side_effect = [(None,), ('row-id',), ('row-id',)]

        event = make_event(method='PUT', path='/clients', body={
            'client_id': 'c123',
            'company_name': 'Test Corp'
        })
        clients_module.lambda_handler(event, None)
        executed_sql = [c.args[0] for c in mock_cur.execute.call_args_list]
        update_sql = [s for s in executed_sql if s.lstrip().startswith('UPDATE clients')]
        assert update_sql
        chosen = update_sql[-1]
        assert 'account_id = %s' in chosen, f"got: {chosen}"
        assert 'client_shares' in chosen, \
            f"account_admin UPDATE must include share OR clause: {chosen}"


class TestDeleteClient:
    def test_client_user_cannot_delete(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (CLIENT_USER, None)

        event = make_event(method='DELETE', path='/clients',
                           query_params={'client_id': 'c123'})
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 403)

    def test_partner_user_cannot_delete(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (PARTNER_USER, None)

        event = make_event(method='DELETE', path='/clients',
                           query_params={'client_id': 'c123'})
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 403)

    def test_missing_client_id_returns_400(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)

        event = make_event(method='DELETE', path='/clients', query_params={})
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 400)


class TestListClients:
    def test_list_returns_empty(self, clients_module, mock_deps):
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)
        mock_cur.fetchall.return_value = []

        event = make_event(method='GET', path='/clients/list')
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 200)
        body = parse_body(response)
        assert body['clients'] == []

    def test_super_admin_list_query_unfiltered(self, clients_module, mock_deps):
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (SUPER_ADMIN_USER, None)
        mock_cur.fetchall.return_value = []

        event = make_event(method='GET', path='/clients/list')
        clients_module.lambda_handler(event, None)
        executed_sql = [c.args[0] for c in mock_cur.execute.call_args_list]
        list_sql = [s for s in executed_sql if 'FROM clients c' in s]
        assert list_sql, f"expected list query, got: {executed_sql}"
        chosen = list_sql[-1]
        assert 'WHERE c.account_id' not in chosen
        assert 'user_client_assignments' not in chosen
        assert 'WHERE c.user_id' not in chosen

    def test_account_user_list_query_uses_uca_join(self, clients_module, mock_deps):
        """PR 3.4: helper produces an IN subquery rather than a JOIN —
        same semantics, different SQL shape. Test now matches the substring."""
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_USER, None)
        mock_cur.fetchone.return_value = (0,)
        mock_cur.fetchall.return_value = []

        event = make_event(method='GET', path='/clients/list')
        clients_module.lambda_handler(event, None)
        executed_sql = [c.args[0] for c in mock_cur.execute.call_args_list]
        joined = [s for s in executed_sql if 'user_client_assignments' in s]
        assert joined, f"expected UCA join in account_user list, got: {executed_sql}"

    def test_account_admin_list_query_filters_by_account(self, clients_module, mock_deps):
        """PR 3.4: helper produces owned-OR-shared fragment. Both branches
        must be present; the share branch references client_shares."""
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        mock_cur.fetchall.return_value = []

        event = make_event(method='GET', path='/clients/list')
        clients_module.lambda_handler(event, None)
        executed_sql = [c.args[0] for c in mock_cur.execute.call_args_list]
        list_sql = [s for s in executed_sql if 'FROM clients c' in s]
        assert list_sql
        chosen = list_sql[-1]
        assert 'c.account_id = %s' in chosen, f"got: {chosen}"
        assert 'client_shares' in chosen, \
            f"account_admin list must include share OR clause: {chosen}"


class TestPartners:
    def test_client_user_cannot_access_partners(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (CLIENT_USER, None)

        event = make_event(method='GET', path='/partners')
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 403)

    def test_partner_cannot_create_partner(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (PARTNER_USER, None)

        event = make_event(method='POST', path='/partners', body={'name': 'Test'})
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 403)

    def test_create_partner_missing_name(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)

        event = make_event(method='POST', path='/partners', body={})
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 400)


class TestSkills:
    def test_create_skill_missing_name(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)

        event = make_event(method='POST', path='/skills', body={})
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 400)

    def test_create_system_skill_requires_admin(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (PARTNER_USER, None)

        event = make_event(method='POST', path='/skills',
                           body={'name': 'test', 'scope': 'system'})
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 403)

    def test_client_user_cannot_create_skill(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (CLIENT_USER, None)

        event = make_event(method='POST', path='/skills', body={'name': 'test'})
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 403)

    def test_delete_skill_missing_id(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)

        event = make_event(method='DELETE', path='/skills', query_params={})
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 400)

    def test_update_skill_missing_id(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)

        event = make_event(method='PUT', path='/skills', body={})
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 400)


class TestSystemConfig:
    def test_non_admin_cannot_access_system_config(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (REGULAR_USER, None)

        event = make_event(method='GET', path='/system-config')
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 403)

    def test_update_system_config_missing_key(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)

        event = make_event(method='PUT', path='/system-config', body={})
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 400)


class TestInvite:
    def test_invite_missing_fields_returns_400(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps

        event = make_event(method='POST', path='/invite', body={
            'company_name': 'Test Corp'
        })
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 400)


class TestGenerateClientConfig:
    def test_basic_config(self, clients_module):
        config = clients_module.generate_client_config(
            'Test Corp', 'https://test.com', 'John Doe', 'CEO',
            'https://linkedin.com/in/jd', 'Technology', 'A tech company', 'Needs automation'
        )
        assert '# Client Configuration' in config
        assert 'Test Corp' in config
        assert 'CEO' in config
        assert 'Technology' in config

    def test_config_with_contacts(self, clients_module):
        contacts = [
            {'firstName': 'Jane', 'lastName': 'Doe', 'email': 'j@test.com', 'title': 'CTO'},
            {'firstName': 'Bob', 'lastName': 'Smith', 'email': 'b@test.com'}
        ]
        config = clients_module.generate_client_config(
            'Test Corp', '', '', '', '', '', '', '',
            contacts=contacts
        )
        assert 'Jane Doe' in config
        assert 'Bob Smith' in config
        assert 'Primary Contact' in config

    def test_config_with_addresses(self, clients_module):
        addresses = [{'address1': '123 Main St', 'city': 'NY', 'state': 'NY', 'postalCode': '10001'}]
        config = clients_module.generate_client_config(
            'Test Corp', '', '', '', '', '', '', '',
            addresses=addresses
        )
        assert '123 Main St' in config
        assert 'NY' in config

    def test_config_with_pain_points(self, clients_module):
        config = clients_module.generate_client_config(
            'Test Corp', '', '', '', '', '', '', '',
            pain_points=['Slow processes', 'Data silos']
        )
        assert 'Slow processes' in config
        assert 'Data silos' in config
        assert 'Pain Points' in config


# ──────────────────────────────────────────────
# PR 3.4 — Share API
#   POST   /clients/{client_id}/shares
#   DELETE /clients/{client_id}/shares/{account_id}
#   GET    /clients/{client_id}/shares
# Admin-only sharing (Ken's Q3): account_admin or super_admin in the
# OWNING account can grant/revoke. Recipients cannot re-grant onward.
# ──────────────────────────────────────────────

SHARE_CLIENT_ID = 'client-uuid-1'
# ACCOUNT_ADMIN_USER in conftest has account_id=2, so the OWNER fixtures
# below use 2 to model "admin in the owning account". RECIPIENT_ACCOUNT
# is any other integer.
OWNING_ACCOUNT = 2
RECIPIENT_ACCOUNT = 99


def _share_event(method, client_id=SHARE_CLIENT_ID, recipient=None,
                 body=None):
    """Build an event with the standard pathParameters shape."""
    path = f'/clients/{client_id}/shares'
    path_params = {'client_id': client_id}
    if recipient is not None:
        path += f'/{recipient}'
        path_params['account_id'] = str(recipient)
    return make_authed_event(method=method, path=path, body=body,
                             path_params=path_params)


class TestShareApiGrant:
    def test_account_admin_owner_grants_share(self, clients_module, mock_deps):
        started, _, mock_cur, _ = mock_deps
        # ACCOUNT_ADMIN_USER has account_id=42; client also owned by 42.
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        # _require_admin_in_owning_account SELECT account_id FROM clients → owning=42
        # INSERT ... RETURNING granted_at → datetime
        now = datetime.now(timezone.utc)
        mock_cur.fetchone.side_effect = [(OWNING_ACCOUNT,), (now,)]

        event = _share_event('POST', body={
            'account_id': RECIPIENT_ACCOUNT,
            'permissions': 'read_write',
        })
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 200)
        body = parse_body(response)
        assert body['granted'] is True
        assert body['shared_with_account_id'] == RECIPIENT_ACCOUNT
        assert body['permissions'] == 'read_write'

        # Verify the INSERT carried the right parameters
        executed = [c.args for c in mock_cur.execute.call_args_list]
        inserts = [c for c in executed if 'INSERT INTO client_shares' in c[0]]
        assert len(inserts) == 1
        params = inserts[0][1]
        assert params == (SHARE_CLIENT_ID, RECIPIENT_ACCOUNT,
                          ACCOUNT_ADMIN_USER['user_id'], 'read_write')

    def test_account_user_cannot_grant(self, clients_module, mock_deps):
        """Q3 admin-only: account_user gets 403 even within the owning account."""
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_USER, None)
        event = _share_event('POST', body={'account_id': RECIPIENT_ACCOUNT,
                                           'permissions': 'read_write'})
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 403)
        # No INSERT happened.
        executed = [c.args[0] for c in mock_cur.execute.call_args_list]
        assert not any('INSERT INTO client_shares' in s for s in executed)

    def test_client_contact_cannot_grant(self, clients_module, mock_deps):
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (CLIENT_CONTACT_USER, None)
        event = _share_event('POST', body={'account_id': RECIPIENT_ACCOUNT,
                                           'permissions': 'read_write'})
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 403)

    def test_recipient_cannot_re_grant(self, clients_module, mock_deps):
        """LOAD-BEARING: an account_admin in the RECIPIENT account cannot
        re-grant the same client onward. Only the owning account can grant."""
        started, _, mock_cur, _ = mock_deps
        # Scenario: ACCOUNT_ADMIN_USER (whatever account they are in, per
        # conftest) is acting as the RECIPIENT of a share — i.e., the
        # client they are touching is owned by a DIFFERENT account. The
        # mock returns RECIPIENT_ACCOUNT (99) as the owning account_id so
        # _require_admin_in_owning_account sees user.account_id != owning
        # and rejects with the "OWNING account" error.
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        mock_cur.fetchone.return_value = (RECIPIENT_ACCOUNT,)
        event = _share_event('POST', body={'account_id': 12345,
                                           'permissions': 'read_write'})
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 403)
        assert 'OWNING account' in parse_body(response)['error']

    def test_self_share_rejected(self, clients_module, mock_deps):
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        mock_cur.fetchone.return_value = (OWNING_ACCOUNT,)
        event = _share_event('POST', body={
            'account_id': OWNING_ACCOUNT,   # same as owner
            'permissions': 'read_write',
        })
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 400)
        assert 'own owning account' in parse_body(response)['error']

    def test_bad_permissions_rejected(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        event = _share_event('POST', body={
            'account_id': RECIPIENT_ACCOUNT,
            'permissions': 'admin',   # not in the enum
        })
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 400)

    def test_missing_recipient_rejected(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        event = _share_event('POST', body={'permissions': 'read_write'})
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 400)

    def test_super_admin_can_grant_any_client(self, clients_module, mock_deps):
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (SUPER_ADMIN_USER, None)
        now = datetime.now(timezone.utc)
        # super_admin: SELECT account_id → 12345, then INSERT RETURNING.
        mock_cur.fetchone.side_effect = [(12345,), (now,)]
        event = _share_event('POST', body={
            'account_id': RECIPIENT_ACCOUNT,
            'permissions': 'read_only',
        })
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 200)


class TestShareApiRevoke:
    def test_account_admin_owner_revokes(self, clients_module, mock_deps):
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        mock_cur.fetchone.return_value = (OWNING_ACCOUNT,)
        mock_cur.rowcount = 1
        event = _share_event('DELETE', recipient=RECIPIENT_ACCOUNT)
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 200)
        body = parse_body(response)
        assert body['revoked'] is True
        executed = [c.args for c in mock_cur.execute.call_args_list]
        deletes = [c for c in executed if 'DELETE FROM client_shares' in c[0]]
        assert len(deletes) == 1
        assert deletes[0][1] == (SHARE_CLIENT_ID, RECIPIENT_ACCOUNT)

    def test_account_user_cannot_revoke(self, clients_module, mock_deps):
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_USER, None)
        event = _share_event('DELETE', recipient=RECIPIENT_ACCOUNT)
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 403)
        executed = [c.args[0] for c in mock_cur.execute.call_args_list]
        assert not any('DELETE FROM client_shares' in s for s in executed)

    def test_bad_account_id_in_path_rejected(self, clients_module, mock_deps):
        started, _, _, _ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        event = _share_event('DELETE', recipient='not-an-int')
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 400)


class TestShareApiList:
    def test_owner_sees_all_grants(self, clients_module, mock_deps):
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        # SELECT account_id → 42 (matches user). SELECT shares → 2 rows.
        mock_cur.fetchone.return_value = (OWNING_ACCOUNT,)
        now = datetime.now(timezone.utc)
        mock_cur.fetchall.return_value = [
            (RECIPIENT_ACCOUNT, 'read_write', 'u-grantor', now),
            (12345,            'read_only',  'u-grantor', now),
        ]
        event = _share_event('GET')
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 200)
        body = parse_body(response)
        assert len(body['shares']) == 2
        # The SELECT used by owner returns ALL grants for the client
        executed = [c.args for c in mock_cur.execute.call_args_list]
        list_queries = [
            c for c in executed
            if 'FROM client_shares' in c[0] and 'shared_with_account_id' not in c[0].split('WHERE')[1]
        ]
        assert list_queries, "owner list query should not filter by shared_with_account_id"

    def test_recipient_sees_only_own_grant(self, clients_module, mock_deps):
        """ACCOUNT_ADMIN_USER (account 42) viewing a client owned by 99.
        Query must filter by shared_with_account_id = 42."""
        started, _, mock_cur, _ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        # Owning account = 99 (not user's 42)
        mock_cur.fetchone.return_value = (RECIPIENT_ACCOUNT,)
        now = datetime.now(timezone.utc)
        mock_cur.fetchall.return_value = [(OWNING_ACCOUNT, 'read_write', 'u-x', now)]
        event = _share_event('GET')
        response = clients_module.lambda_handler(event, None)
        assert_status(response, 200)
        executed = [c.args for c in mock_cur.execute.call_args_list]
        recipient_queries = [
            c for c in executed
            if 'FROM client_shares' in c[0] and 'shared_with_account_id = %s' in c[0]
        ]
        assert len(recipient_queries) == 1
        # Query must be scoped to the JWT's account_id, not an attacker-supplied value
        assert recipient_queries[0][1] == (SHARE_CLIENT_ID, OWNING_ACCOUNT)
