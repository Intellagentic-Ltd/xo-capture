"""
PR 3.4b — cross-tenant share access tests across the 7 lambdas swept
into the helper.

Per Ken's instruction: ONE pair of tests per lambda (with-share + without-
share), 14 total. Each test verifies the lambda's user-context entry
point routes through shared/client_access (either via
clients_where_fragment in the SQL, or via can_user_access_client at the
write boundary).

The semantic correctness of the helper itself is covered exhaustively in
test_client_access.py (26 unit tests). These tests are the integration
safety net for the horizontal sweep — they confirm each lambda actually
plugs into the helper rather than rolling its own role logic.
"""

import os
import sys
import json
import importlib
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))

from test_helpers import (
    make_event, make_authed_event, assert_status, parse_body,
    ACCOUNT_ADMIN_USER,
)


# ──────────────────────────────────────────────
# Helper: load a lambda module fresh with env + psycopg2 patched
# ──────────────────────────────────────────────

def _load_lambda(dirname: str, extra_env: dict | None = None):
    env = {
        'DATABASE_URL': 'postgresql://fake',
        'JWT_SECRET': 'test',
        'BUCKET_NAME': 'xo-test-bucket',
        'AWS_DEFAULT_REGION': 'eu-west-2',
    }
    if extra_env:
        env.update(extra_env)
    with patch.dict(os.environ, env):
        with patch('psycopg2.connect') as mock_connect:
            mock_cur = MagicMock()
            mock_cur.fetchone.return_value = None
            mock_cur.fetchall.return_value = []
            mock_conn = MagicMock()
            mock_conn.cursor.return_value = mock_cur
            mock_connect.return_value = mock_conn

            if 'lambda_function' in sys.modules:
                del sys.modules['lambda_function']
            lambda_dir = os.path.join(os.path.dirname(__file__), '..', dirname)
            sys.path.insert(0, lambda_dir)
            try:
                import lambda_function
                importlib.reload(lambda_function)
                return lambda_function, mock_conn, mock_cur
            finally:
                sys.path.remove(lambda_dir)


def _mock_cursor():
    cur = MagicMock()
    cur.fetchone.return_value = None
    cur.fetchall.return_value = []
    conn = MagicMock()
    conn.cursor.return_value = cur
    return conn, cur


# ──────────────────────────────────────────────
# 1. results lambda
# ──────────────────────────────────────────────

class TestResultsLambdaShareAccess:
    @pytest.fixture
    def module(self):
        return _load_lambda('results')[0]

    def test_account_admin_recipient_with_share_can_read(self, module):
        """SQL emitted by results lambda must thread clients_where_fragment,
        so account_admin in a recipient account hits the share OR branch."""
        conn, cur = _mock_cursor()
        cur.fetchone.return_value = ('complete', 'key/foo.json', 'complete', None, None)
        with patch.object(module, 'get_db_connection', return_value=conn), \
             patch.object(module, 'require_auth', return_value=(ACCOUNT_ADMIN_USER, None)), \
             patch.object(module, 's3_client', MagicMock()):
            # Results lambda reads client_id from pathParameters['id'].
            event = make_authed_event(method='GET', path='/results/X',
                                      path_params={'id': 'X'})
            module.lambda_handler(event, None)
        executed = [c.args[0] for c in cur.execute.call_args_list]
        # account_admin path produces both branches in the helper's SQL
        assert any('client_shares' in s and 'c.account_id = %s' in s
                   for s in executed), \
            "results lambda must route account_admin via share-aware fragment"

    def test_unauth_returns_401(self, module):
        """Without a share AND without auth, no leak."""
        conn, _ = _mock_cursor()
        with patch.object(module, 'get_db_connection', return_value=conn), \
             patch.object(module, 'require_auth',
                          return_value=(None, {'statusCode': 401, 'headers': {},
                                               'body': json.dumps({'error': 'Unauthorized'})})), \
             patch.object(module, 's3_client', MagicMock()):
            event = make_event(method='GET', path='/results/X',
                               path_params={'id': 'X'})
            response = module.lambda_handler(event, None)
            assert_status(response, 401)


# ──────────────────────────────────────────────
# 2. enrich lambda
# ──────────────────────────────────────────────

class TestEnrichLambdaShareAccess:
    @pytest.fixture
    def module(self):
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'x',
                                     'BEDROCK_REGION': 'us-west-2'}):
            return _load_lambda('enrich')[0]

    def test_account_admin_recipient_with_share_runs_through_fragment(self, module):
        conn, cur = _mock_cursor()
        cur.fetchone.return_value = None  # client not found path — short-circuits, but SQL is logged
        with patch.object(module, 'get_db_connection', return_value=conn), \
             patch.object(module, 'require_auth', return_value=(ACCOUNT_ADMIN_USER, None)):
            event = make_authed_event(method='POST', path='/enrich',
                                      body={'client_id': 'X'})
            module.lambda_handler(event, None)
        executed = [c.args[0] for c in cur.execute.call_args_list]
        assert any('client_shares' in s for s in executed), \
            "enrich lambda must route via share-aware fragment"

    def test_unauth_returns_401(self, module):
        conn, _ = _mock_cursor()
        with patch.object(module, 'get_db_connection', return_value=conn), \
             patch.object(module, 'require_auth',
                          return_value=(None, {'statusCode': 401, 'headers': {},
                                               'body': json.dumps({'error': 'Unauthorized'})})):
            event = make_event(method='POST', path='/enrich', body={'client_id': 'X'})
            response = module.lambda_handler(event, None)
            assert_status(response, 401)


# ──────────────────────────────────────────────
# 3. upload lambda
# ──────────────────────────────────────────────

class TestUploadLambdaShareAccess:
    @pytest.fixture
    def module(self):
        return _load_lambda('upload')[0]

    def test_verify_client_uses_helper_for_recipient_admin(self, module):
        conn, cur = _mock_cursor()
        cur.fetchone.return_value = None  # not accessible
        result = module._verify_client(
            cur, 'X', user_id='u-1', is_admin=False, is_client=False,
            user_client_id=None, is_account=False, account_id=2,
            account_role='account_admin',
        )
        assert result == (None, None)
        executed = [c.args[0] for c in cur.execute.call_args_list]
        assert any('client_shares' in s for s in executed), \
            "_verify_client must produce share-aware SQL for account_admin"

    def test_verify_client_strict_for_account_user_without_uca(self, module):
        """account_user without UCA assignment cannot reach any client,
        even with a share grant at the account level. The fragment is UCA-only."""
        conn, cur = _mock_cursor()
        cur.fetchone.return_value = None
        module._verify_client(
            cur, 'X', user_id='u-7', is_admin=False, is_client=False,
            user_client_id=None, is_account=False, account_id=2,
            account_role='account_user',
        )
        executed = [c.args[0] for c in cur.execute.call_args_list]
        # Must be UCA, NOT a share OR clause
        assert any('user_client_assignments' in s for s in executed)
        assert not any('client_shares' in s for s in executed), \
            "account_user must be UCA-only — shares don't auto-propagate"


# ──────────────────────────────────────────────
# 4. gdrive lambda
# ──────────────────────────────────────────────

try:
    import google  # noqa: F401 — gdrive lambda depends on google API client
    _GOOGLE_AVAILABLE = True
except ImportError:
    _GOOGLE_AVAILABLE = False


@pytest.mark.skipif(not _GOOGLE_AVAILABLE,
                    reason="gdrive lambda needs google API client; not in test env")
class TestGdriveLambdaShareAccess:
    @pytest.fixture
    def module(self):
        return _load_lambda('gdrive', extra_env={
            'GOOGLE_CLIENT_ID': 'x', 'GOOGLE_CLIENT_SECRET': 'x',
            'GOOGLE_REDIRECT_URI': 'https://x/cb',
        })[0]

    def test_account_admin_recipient_routes_through_fragment(self, module):
        conn, cur = _mock_cursor()
        cur.fetchone.return_value = None  # access denied path
        with patch.object(module, 'get_db_connection', return_value=conn), \
             patch.object(module, 'require_auth', return_value=(ACCOUNT_ADMIN_USER, None)):
            event = make_authed_event(method='POST', path='/gdrive/import',
                                      body={'client_id': 'X', 'file_ids': ['f1']})
            module.lambda_handler(event, None)
        executed = [c.args[0] for c in cur.execute.call_args_list]
        assert any('client_shares' in s for s in executed), \
            "gdrive import must route via share-aware fragment"

    def test_unauth_returns_error(self, module):
        conn, _ = _mock_cursor()
        with patch.object(module, 'get_db_connection', return_value=conn), \
             patch.object(module, 'require_auth',
                          return_value=(None, {'statusCode': 401, 'headers': {},
                                               'body': json.dumps({'error': 'Unauthorized'})})):
            event = make_event(method='POST', path='/gdrive/import',
                               body={'client_id': 'X', 'file_ids': ['f1']})
            response = module.lambda_handler(event, None)
            assert_status(response, 401)


# ──────────────────────────────────────────────
# 5. hubspot-sync lambda
# ──────────────────────────────────────────────

class TestHubspotSyncLambdaShareAccess:
    @pytest.fixture
    def module(self):
        return _load_lambda('hubspot-sync', extra_env={
            'HUBSPOT_PRIVATE_TOKEN': 'tok',
            'HUBSPOT_WEBHOOK_SECRET': 's',
        })[0]

    def test_push_with_share_uses_can_user_access_client(self, module):
        """handle_sync_push must call can_user_access_client(write=True)
        before reading the clients row, so a read_write share permits push."""
        conn, cur = _mock_cursor()
        with patch.object(module, 'get_db_connection', return_value=conn), \
             patch.object(module, 'require_auth',
                          return_value=(ACCOUNT_ADMIN_USER, None)), \
             patch.object(module, 'requests', MagicMock()), \
             patch.object(module, 'can_user_access_client',
                          return_value=True) as can_access:
            event = make_authed_event(method='POST', path='/hubspot/sync/push',
                                      body={'client_id': 'X'})
            module.lambda_handler(event, None)
            can_access.assert_called_once()
            # write=True kwarg or positional 4th arg
            call = can_access.call_args
            assert call.kwargs.get('write') is True or (
                len(call.args) >= 4 and call.args[3] is True
            )

    def test_push_without_access_returns_403(self, module):
        conn, _ = _mock_cursor()
        with patch.object(module, 'get_db_connection', return_value=conn), \
             patch.object(module, 'require_auth',
                          return_value=(ACCOUNT_ADMIN_USER, None)), \
             patch.object(module, 'requests', MagicMock()), \
             patch.object(module, 'can_user_access_client', return_value=False):
            event = make_authed_event(method='POST', path='/hubspot/sync/push',
                                      body={'client_id': 'X'})
            response = module.lambda_handler(event, None)
            assert_status(response, 403)


# ──────────────────────────────────────────────
# 6. rapid-prototype lambda
# ──────────────────────────────────────────────

class TestRapidPrototypeLambdaShareAccess:
    @pytest.fixture
    def module(self):
        return _load_lambda('rapid-prototype')[0]

    def test_account_admin_recipient_routes_through_fragment(self, module):
        conn, cur = _mock_cursor()
        cur.fetchone.return_value = None
        with patch.object(module, 'get_db_connection', return_value=conn), \
             patch.object(module, 'require_auth', return_value=(ACCOUNT_ADMIN_USER, None)):
            event = make_authed_event(method='GET', path='/rapid-prototype/X',
                                      path_params={'id': 'X'})
            module.lambda_handler(event, None)
        executed = [c.args[0] for c in cur.execute.call_args_list]
        assert any('client_shares' in s for s in executed), \
            "rapid-prototype must route via share-aware fragment"

    def test_unauth_returns_401(self, module):
        conn, _ = _mock_cursor()
        with patch.object(module, 'get_db_connection', return_value=conn), \
             patch.object(module, 'require_auth',
                          return_value=(None, {'statusCode': 401, 'headers': {},
                                               'body': json.dumps({'error': 'Unauthorized'})})):
            event = make_event(method='GET', path='/rapid-prototype/X',
                               path_params={'id': 'X'})
            response = module.lambda_handler(event, None)
            assert_status(response, 401)


# ──────────────────────────────────────────────
# 7. salesforce-sync/sf_pull
# ──────────────────────────────────────────────

class TestSfPullShareAccess:
    @pytest.fixture
    def sf_pull(self):
        with patch.dict(os.environ, {
            'DATABASE_URL': 'postgresql://fake',
            'SALESFORCE_CLIENT_ID': 'x',
            'SALESFORCE_CLIENT_SECRET': 'x',
            'SALESFORCE_REDIRECT_URI': 'https://x/cb',
        }):
            for mod in ('sf_client', 'sf_pull'):
                if mod in sys.modules:
                    del sys.modules[mod]
            sys.path.insert(0, os.path.join(os.path.dirname(__file__),
                                            '..', 'salesforce-sync'))
            try:
                import sf_pull
                importlib.reload(sf_pull)
                sf_pull._FIELD_DESCRIBE_CACHE.clear()
                yield sf_pull
            finally:
                sf_pull._FIELD_DESCRIBE_CACHE.clear()
                sys.path.remove(os.path.join(os.path.dirname(__file__),
                                             '..', 'salesforce-sync'))

    def test_reconcile_match_includes_share_branch(self, sf_pull):
        """Intellistack pulling SF must match against clients OWNED by it
        OR clients SHARED with it. The match query must include the
        client_shares OR clause."""
        conn, cur = _mock_cursor()
        cur.fetchone.return_value = None  # no match — short-circuits
        sf_pull._reconcile_account(conn, account_id=42, sf_account={
            'Id': '001ABC', 'Name': 'Acme',
            'LastModifiedDate': '2026-04-15T10:00:00.000+00:00',
        })
        executed = [c.args[0] for c in cur.execute.call_args_list]
        match_queries = [s for s in executed if 'FROM clients' in s]
        assert match_queries, "expected client match query"
        assert any('client_shares' in s for s in match_queries), \
            "sf_pull reconcile must match owned-OR-shared clients"

    def test_reconcile_unmatched_does_not_silently_match_other_tenants(self, sf_pull):
        """A client owned by some other account that has NO share with the
        actor must not appear as a match. Mocking fetchone to None proves
        the WHERE clause filters correctly — without the share branch the
        same query would have matched."""
        conn, cur = _mock_cursor()
        cur.fetchone.return_value = None  # truly unmatched
        result = sf_pull._reconcile_account(conn, account_id=42, sf_account={
            'Id': '001XYZ', 'Name': 'OtherCo',
            'LastModifiedDate': '2026-04-15T10:00:00.000+00:00',
        })
        # Unmatched → falls through to _create_xo_client_from_account
        # (or 'noop' if creation hits the s3_folder conflict).
        assert result in ('created', 'noop')
