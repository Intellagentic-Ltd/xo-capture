"""
Regression tests for salesforce-sync/lambda_function.py.

Coverage focus (per PR 2 constraints):
  - OAuth flow with nonce-based state — 10-min TTL, single-use,
    integration-mismatch rejection (CSRF defense)
  - Tenant leak — account_id always sourced from the JWT, never from the
    request body. Both write paths (connect/callback storing tokens) and
    read paths (sync/push reading tokens) MUST be scoped to JWT's
    account_id.
  - Role enforcement on connect/disconnect (account_admin / super_admin).
  - Standard-field push only — no Metadata API calls.
"""

import os
import sys
import json
import importlib
import pytest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'salesforce-sync'))

from test_helpers import (
    make_event, make_authed_event, assert_status, parse_body, ADMIN_USER,
)


# ──────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────

ACCOUNT_ADMIN_USER = {
    'user_id': 'aa-uuid-001', 'email': 'admin@partner.com', 'name': 'Account Admin',
    'role': 'partner', 'is_admin': False, 'is_account': True, 'is_client': False,
    'account_id': 42, 'account_role': 'account_admin', 'client_id': None,
}

ACCOUNT_USER = {
    'user_id': 'au-uuid-001', 'email': 'user@partner.com', 'name': 'Account User',
    'role': 'partner', 'is_admin': False, 'is_account': True, 'is_client': False,
    'account_id': 42, 'account_role': 'account_user', 'client_id': None,
}

SUPER_ADMIN_NO_ACCOUNT = {
    'user_id': 'sa-uuid-001', 'email': 'super@xo.com', 'name': 'Super',
    'role': 'admin', 'is_admin': True, 'is_account': False, 'is_client': False,
    'account_id': None, 'account_role': 'super_admin', 'client_id': None,
}


@pytest.fixture
def salesforce_module():
    """Import the SF lambda fresh with env + psycopg2 patched."""
    with patch.dict(os.environ, {
        'DATABASE_URL': 'postgresql://fake',
        'JWT_SECRET': 'test-jwt-secret',
        'SALESFORCE_CLIENT_ID': 'sf-client-id',
        'SALESFORCE_CLIENT_SECRET': 'sf-client-secret',
        'SALESFORCE_REDIRECT_URI': 'https://xo.example/salesforce/callback',
        'SALESFORCE_LOGIN_URL': 'https://login.salesforce.com',
    }):
        with patch('psycopg2.connect') as mock_connect:
            mock_cur = MagicMock()
            mock_cur.fetchone.return_value = None
            mock_cur.fetchall.return_value = []
            mock_conn = MagicMock()
            mock_conn.cursor.return_value = mock_cur
            mock_connect.return_value = mock_conn

            # PR 3: env-dependent constants (SALESFORCE_CLIENT_ID etc) live
            # in sf_client and freeze at import time. Evict the SF-local
            # modules so they re-read os.environ inside this patch context.
            for mod in ('lambda_function', 'sf_client', 'sf_pull', 'sf_webhook'):
                if mod in sys.modules:
                    del sys.modules[mod]
            sf_dir = os.path.join(os.path.dirname(__file__), '..', 'salesforce-sync')
            sys.path.insert(0, sf_dir)
            try:
                import lambda_function
                importlib.reload(lambda_function)
                yield lambda_function
            finally:
                sys.path.remove(sf_dir)
                for mod in ('lambda_function', 'sf_client', 'sf_pull', 'sf_webhook'):
                    if mod in sys.modules:
                        del sys.modules[mod]


@pytest.fixture
def mock_deps():
    """Patches the SF lambda's external collaborators."""
    mock_cur = MagicMock()
    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cur
    mock_cur.fetchone.return_value = None
    mock_cur.fetchall.return_value = []

    # PR 3 refactor: SF HTTP/token helpers live in sf_client.py. Patch
    # `sf_client.requests` for HTTP, `sf_client.set_account_config` /
    # `sf_client.get_account_config` for token storage. `lambda_function`
    # still owns auth/route plumbing and re-exports symbols from sf_client.
    # PR 3.4: can_user_access_client now lives inside lambda_function as an
    # imported symbol and runs its own DB queries. Patch it here with default
    # True so tests that don't care about access semantics see the happy
    # path. Tests that want to assert the 403 path override the return value.
    patches = {
        'get_db_connection': patch('lambda_function.get_db_connection', return_value=mock_conn),
        'require_auth': patch('lambda_function.require_auth'),
        'requests': patch('sf_client.requests'),
        'create_oauth_nonce': patch('lambda_function.create_oauth_nonce'),
        'consume_oauth_nonce': patch('lambda_function.consume_oauth_nonce'),
        'set_account_config': patch('sf_client.set_account_config'),
        'get_account_config': patch('sf_client.get_account_config'),
        'delete_account_config': patch('lambda_function.delete_account_config'),
        'can_user_access_client': patch('lambda_function.can_user_access_client',
                                        return_value=True),
    }
    started = {k: p.start() for k, p in patches.items()}
    yield started, mock_conn, mock_cur
    for p in patches.values():
        p.stop()


# ──────────────────────────────────────────────
# Options + routing
# ──────────────────────────────────────────────

class TestOptionsHandler:
    def test_options_returns_200(self, salesforce_module, mock_deps):
        event = make_event(method='OPTIONS', path='/salesforce/status')
        response = salesforce_module.lambda_handler(event, None)
        assert_status(response, 200)


class TestRouting:
    def test_unknown_route_returns_404(self, salesforce_module, mock_deps):
        started, *_ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        event = make_authed_event(method='GET', path='/salesforce/nonsense')
        response = salesforce_module.lambda_handler(event, None)
        assert_status(response, 404)

    def test_callback_path_bypasses_auth(self, salesforce_module, mock_deps):
        """Browser redirect from Salesforce arrives without a JWT —
        the lambda must NOT call require_auth on the callback path."""
        started, *_ = mock_deps
        started['consume_oauth_nonce'].return_value = None  # forces 400
        event = make_event(method='GET', path='/salesforce/callback',
                           query_params={'state': 'x', 'code': 'y'})
        salesforce_module.lambda_handler(event, None)
        started['require_auth'].assert_not_called()


class TestAuthRequired:
    def test_no_jwt_returns_401(self, salesforce_module, mock_deps):
        started, *_ = mock_deps
        started['require_auth'].return_value = (None, {
            'statusCode': 401, 'headers': {},
            'body': json.dumps({'error': 'Unauthorized'}),
        })
        event = make_event(method='GET', path='/salesforce/status')
        response = salesforce_module.lambda_handler(event, None)
        assert_status(response, 401)


# ──────────────────────────────────────────────
# /salesforce/connect — role + nonce gate
# ──────────────────────────────────────────────

class TestConnect:
    def test_connect_requires_admin_role(self, salesforce_module, mock_deps):
        started, *_ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_USER, None)
        event = make_authed_event(method='POST', path='/salesforce/connect')
        response = salesforce_module.lambda_handler(event, None)
        assert_status(response, 403)
        assert 'account_admin' in parse_body(response)['error']

    def test_connect_super_admin_no_account_returns_400(self, salesforce_module, mock_deps):
        """Super admin without an account_id can't connect — they'd have to
        impersonate an account. Prevents silent 'connect to nowhere'."""
        started, *_ = mock_deps
        started['require_auth'].return_value = (SUPER_ADMIN_NO_ACCOUNT, None)
        event = make_authed_event(method='POST', path='/salesforce/connect')
        response = salesforce_module.lambda_handler(event, None)
        assert_status(response, 400)
        assert 'account_id' in parse_body(response)['error']

    def test_connect_missing_env_returns_500(self, salesforce_module, mock_deps):
        started, *_ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        with patch.object(salesforce_module, 'SALESFORCE_CLIENT_ID', ''):
            event = make_authed_event(method='POST', path='/salesforce/connect')
            response = salesforce_module.lambda_handler(event, None)
            assert_status(response, 500)

    def test_connect_mints_nonce_with_jwt_account_id(self, salesforce_module, mock_deps):
        """TENANT LEAK GATE: nonce must be minted with the JWT's account_id,
        not an attacker-supplied value from the request body."""
        started, *_ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        started['create_oauth_nonce'].return_value = 'nonce-xyz'
        event = make_authed_event(
            method='POST', path='/salesforce/connect',
            body={'account_id': 9999},  # attacker tries to override
        )
        response = salesforce_module.lambda_handler(event, None)
        assert_status(response, 200)
        kwargs = started['create_oauth_nonce'].call_args.kwargs
        # Must be the JWT's account_id (42), not 9999.
        assert kwargs['account_id'] == 42
        assert kwargs['integration'] == 'salesforce'
        assert kwargs['user_id'] == 'aa-uuid-001'

    def test_connect_returns_auth_url_with_nonce_as_state(self, salesforce_module, mock_deps):
        started, *_ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        started['create_oauth_nonce'].return_value = 'NONCE_VAL'
        event = make_authed_event(method='POST', path='/salesforce/connect')
        response = salesforce_module.lambda_handler(event, None)
        url = parse_body(response)['auth_url']
        assert url.startswith('https://login.salesforce.com/services/oauth2/authorize?')
        assert 'state=NONCE_VAL' in url
        assert 'client_id=sf-client-id' in url
        assert 'scope=api+refresh_token' in url


# ──────────────────────────────────────────────
# /salesforce/callback — nonce-bound CSRF defense
# ──────────────────────────────────────────────

class TestCallback:
    def test_callback_missing_state_returns_400(self, salesforce_module, mock_deps):
        event = make_event(method='GET', path='/salesforce/callback',
                           query_params={'code': 'abc'})
        response = salesforce_module.lambda_handler(event, None)
        assert_status(response, 400)
        assert 'state' in parse_body(response)['error']

    def test_callback_missing_code_returns_400(self, salesforce_module, mock_deps):
        event = make_event(method='GET', path='/salesforce/callback',
                           query_params={'state': 'n'})
        response = salesforce_module.lambda_handler(event, None)
        assert_status(response, 400)
        assert 'code' in parse_body(response)['error']

    def test_callback_unknown_nonce_returns_400(self, salesforce_module, mock_deps):
        started, *_ = mock_deps
        started['consume_oauth_nonce'].return_value = None  # unknown/expired
        event = make_event(method='GET', path='/salesforce/callback',
                           query_params={'state': 'unknown', 'code': 'abc'})
        response = salesforce_module.lambda_handler(event, None)
        assert_status(response, 400)
        assert 'state nonce' in parse_body(response)['error']
        # No tokens written
        started['set_account_config'].assert_not_called()

    def test_callback_wrong_integration_nonce_returns_400(self, salesforce_module, mock_deps):
        """A 'gong' nonce must not work on a salesforce callback."""
        started, *_ = mock_deps
        started['consume_oauth_nonce'].return_value = {
            'account_id': 42, 'client_id': None,
            'user_id': 'aa-uuid-001', 'integration': 'gong',
        }
        event = make_event(method='GET', path='/salesforce/callback',
                           query_params={'state': 'mixup', 'code': 'abc'})
        response = salesforce_module.lambda_handler(event, None)
        assert_status(response, 400)
        assert 'integration mismatch' in parse_body(response)['error']
        started['set_account_config'].assert_not_called()

    def test_callback_token_exchange_failure_returns_400(self, salesforce_module, mock_deps):
        started, *_ = mock_deps
        started['consume_oauth_nonce'].return_value = {
            'account_id': 42, 'client_id': None,
            'user_id': 'aa-uuid-001', 'integration': 'salesforce',
        }
        # Simulate SF returning an error from /oauth2/token
        bad_resp = MagicMock()
        bad_resp.status_code = 400
        bad_resp.json.return_value = {'error': 'invalid_grant'}
        started['requests'].post.return_value = bad_resp
        event = make_event(method='GET', path='/salesforce/callback',
                           query_params={'state': 'n', 'code': 'expired'})
        response = salesforce_module.lambda_handler(event, None)
        assert_status(response, 400)
        started['set_account_config'].assert_not_called()

    def test_callback_writes_tokens_to_nonce_account_id(self, salesforce_module, mock_deps):
        """LOAD-BEARING TENANT ISOLATION: the account_id that gets the tokens
        MUST come from the consumed nonce row, not from any URL parameter
        or HTTP header. This is the OAuth state CSRF defense in action."""
        started, *_ = mock_deps
        started['consume_oauth_nonce'].return_value = {
            'account_id': 77, 'client_id': None,
            'user_id': 'aa-uuid-001', 'integration': 'salesforce',
        }
        good_resp = MagicMock()
        good_resp.status_code = 200
        good_resp.json.return_value = {
            'access_token': 'AT', 'refresh_token': 'RT',
            'instance_url': 'https://acme.my.salesforce.com',
        }
        started['requests'].post.return_value = good_resp
        event = make_event(method='GET', path='/salesforce/callback',
                           query_params={'state': 'good', 'code': 'auth123'})
        response = salesforce_module.lambda_handler(event, None)
        assert_status(response, 200)

        # All three set_account_config calls must scope to account_id=77.
        keys_written = {}
        for call in started['set_account_config'].call_args_list:
            args = call.args
            assert args[1] == 77, f"token written to account_id={args[1]}, expected 77"
            keys_written[args[2]] = args[3]
        assert keys_written == {
            'salesforce_access_token': 'AT',
            'salesforce_refresh_token': 'RT',
            'salesforce_instance_url': 'https://acme.my.salesforce.com',
        }


# ──────────────────────────────────────────────
# /salesforce/status — read-only connection check
# ──────────────────────────────────────────────

class TestStatus:
    def test_status_when_no_tokens_returns_disconnected(self, salesforce_module, mock_deps):
        started, *_ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        started['get_account_config'].return_value = None
        event = make_authed_event(method='GET', path='/salesforce/status')
        response = salesforce_module.lambda_handler(event, None)
        assert_status(response, 200)
        body = parse_body(response)
        assert body['connected'] is False
        assert body['instance_url'] is None

    def test_status_when_connected_returns_instance_url(self, salesforce_module, mock_deps):
        started, *_ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)

        # All three token reads succeed
        def gc(conn, account_id, key):
            return {
                'salesforce_access_token': 'AT',
                'salesforce_refresh_token': 'RT',
                'salesforce_instance_url': 'https://acme.my.salesforce.com',
            }[key]
        started['get_account_config'].side_effect = gc

        # SF /limits/ returns 200
        good_resp = MagicMock()
        good_resp.status_code = 200
        good_resp.json.return_value = {'DailyApiRequests': {'Max': 15000}}
        started['requests'].request.return_value = good_resp

        event = make_authed_event(method='GET', path='/salesforce/status')
        response = salesforce_module.lambda_handler(event, None)
        body = parse_body(response)
        assert body['connected'] is True
        assert body['instance_url'] == 'https://acme.my.salesforce.com'


# ──────────────────────────────────────────────
# /salesforce/disconnect
# ──────────────────────────────────────────────

class TestDisconnect:
    def test_disconnect_requires_admin(self, salesforce_module, mock_deps):
        started, *_ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_USER, None)
        event = make_authed_event(method='POST', path='/salesforce/disconnect')
        response = salesforce_module.lambda_handler(event, None)
        assert_status(response, 403)

    def test_disconnect_deletes_three_keys_for_jwt_account(self, salesforce_module, mock_deps):
        """Each delete_account_config call must scope to the JWT's account_id."""
        started, *_ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        event = make_authed_event(method='POST', path='/salesforce/disconnect')
        response = salesforce_module.lambda_handler(event, None)
        assert_status(response, 200)

        calls = started['delete_account_config'].call_args_list
        assert len(calls) == 3
        keys_deleted = set()
        for call in calls:
            args = call.args
            assert args[1] == 42  # JWT account_id
            keys_deleted.add(args[2])
        assert keys_deleted == {
            'salesforce_access_token',
            'salesforce_refresh_token',
            'salesforce_instance_url',
        }


# ──────────────────────────────────────────────
# /salesforce/sync/push — tenant isolation
# ──────────────────────────────────────────────

CLIENT_ROW_SAME_ACCOUNT = (
    'client-uuid-1', 'Acme Corp', 'https://acme.com', 'Technology',
    'AI startup', 'Slow onboarding', 'metric1', 'metric2',
    'AI persona text', 'expand to EU', None, 42,  # account_id=42 (matches JWT)
)
CLIENT_ROW_OTHER_ACCOUNT = (
    'client-uuid-2', 'Other Co', None, None, None, None, None, None,
    None, None, None, 99,  # account_id=99 (does NOT match JWT)
)


class TestSyncPush:
    def test_push_requires_client_id(self, salesforce_module, mock_deps):
        started, *_ = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        event = make_authed_event(method='POST', path='/salesforce/sync/push',
                                  body={})
        response = salesforce_module.lambda_handler(event, None)
        assert_status(response, 400)

    def test_push_client_not_found_returns_404(self, salesforce_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        mock_cur.fetchone.return_value = None
        event = make_authed_event(method='POST', path='/salesforce/sync/push',
                                  body={'client_id': 'no-such-uuid'})
        response = salesforce_module.lambda_handler(event, None)
        assert_status(response, 404)

    def test_push_cross_account_returns_403(self, salesforce_module, mock_deps):
        """TENANT ISOLATION: account_admin from account 42 cannot push a
        client owned by account 99 unless a 'read_write' share exists.
        PR 3.4: can_user_access_client returns False when there's no share."""
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        mock_cur.fetchone.return_value = CLIENT_ROW_OTHER_ACCOUNT
        started['can_user_access_client'].return_value = False  # no share
        event = make_authed_event(method='POST', path='/salesforce/sync/push',
                                  body={'client_id': 'client-uuid-2'})
        response = salesforce_module.lambda_handler(event, None)
        assert_status(response, 403)
        started['requests'].request.assert_not_called()

    def test_push_no_sf_tokens_returns_412(self, salesforce_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        mock_cur.fetchone.return_value = CLIENT_ROW_SAME_ACCOUNT
        started['get_account_config'].return_value = None  # no tokens
        event = make_authed_event(method='POST', path='/salesforce/sync/push',
                                  body={'client_id': 'client-uuid-1'})
        response = salesforce_module.lambda_handler(event, None)
        assert_status(response, 412)

    def test_push_reads_tokens_via_jwt_account_id_not_body(
            self, salesforce_module, mock_deps):
        """TENANT LEAK GATE: get_account_config must be called with the
        JWT's account_id, even when the request body tries to override."""
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ACCOUNT_ADMIN_USER, None)
        mock_cur.fetchone.return_value = CLIENT_ROW_SAME_ACCOUNT
        # Token lookup returns nothing — we don't actually push, we just
        # confirm the call binding.
        started['get_account_config'].return_value = None

        event = make_authed_event(
            method='POST', path='/salesforce/sync/push',
            body={'client_id': 'client-uuid-1', 'account_id': 9999},
        )
        salesforce_module.lambda_handler(event, None)

        for call in started['get_account_config'].call_args_list:
            assert call.args[1] == 42, (
                f"token read scoped to {call.args[1]}, expected JWT account_id=42"
            )


# ──────────────────────────────────────────────
# Token refresh on 401
# ──────────────────────────────────────────────

class TestTokenRefresh:
    def test_401_triggers_refresh_and_retry(self, salesforce_module, mock_deps):
        """On 401 from SF, the lambda must call /oauth2/token with
        grant_type=refresh_token, persist the new access token scoped to
        the same account_id, and retry the original call."""
        started, mock_conn, mock_cur = mock_deps
        # Drive _sf_call_with_refresh directly to keep the test focused.
        tokens = {
            'access_token': 'OLD_AT', 'refresh_token': 'RT',
            'instance_url': 'https://acme.my.salesforce.com',
        }

        # First .request() returns 401, second returns 200.
        bad = MagicMock(status_code=401)
        bad.json.return_value = {'error': 'INVALID_SESSION_ID'}
        good = MagicMock(status_code=200)
        good.json.return_value = {'records': []}
        started['requests'].request.side_effect = [bad, good]

        # /oauth2/token refresh succeeds with a NEW access token.
        refresh_resp = MagicMock(status_code=200)
        refresh_resp.json.return_value = {
            'access_token': 'NEW_AT',
            'instance_url': 'https://acme.my.salesforce.com',
        }
        started['requests'].post.return_value = refresh_resp

        # PR 3: sf_call_with_refresh now lives in sf_client.py; import + call
        # there so the patches on sf_client.requests / set_account_config apply.
        import sf_client
        status, body = sf_client.sf_call_with_refresh(
            mock_conn, 42, tokens, 'GET', '/query/', params={'q': 'SELECT Id FROM Account'},
        )

        assert status == 200
        assert tokens['access_token'] == 'NEW_AT'
        # New token was persisted via set_account_config, scoped to account_id=42.
        write_calls = started['set_account_config'].call_args_list
        token_writes = [c for c in write_calls if c.args[2] == 'salesforce_access_token']
        assert len(token_writes) == 1
        assert token_writes[0].args[1] == 42
        assert token_writes[0].args[3] == 'NEW_AT'
