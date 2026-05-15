"""
PR 4 — backend tests for the new SF conflicts endpoints + extended status.

  GET  /salesforce/conflicts                    — unresolved conflicts
  POST /salesforce/conflicts/{log_id}/resolve   — Keep XO / Take SF
  GET  /salesforce/status                       — now includes last_pull_at
                                                  + unresolved_conflicts

Frontend has no automated test framework — manual smoke is the bar for
the UI per Ken's brief. Backend endpoints get unit coverage here.
"""

import os
import sys
import json
import importlib
from unittest.mock import patch, MagicMock

import pytest


sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))


@pytest.fixture
def sf_module():
    """Fresh import of salesforce-sync's lambda_function. The 'lambda_function'
    name is shared across lambda dirs — evict + re-import from the SF path
    so we don't accidentally talk to clients/auth/etc."""
    env = {
        'DATABASE_URL': 'postgresql://fake',
        'JWT_SECRET': 'test',
        'SALESFORCE_CLIENT_ID': 'sf-id',
        'SALESFORCE_CLIENT_SECRET': 'sf-secret',
        'SALESFORCE_REDIRECT_URI': 'https://x/cb',
    }
    with patch.dict(os.environ, env):
        with patch('psycopg2.connect') as mock_connect:
            cur = MagicMock()
            cur.fetchone.return_value = None
            cur.fetchall.return_value = []
            conn = MagicMock()
            conn.cursor.return_value = cur
            mock_connect.return_value = conn
            for mod in ('lambda_function', 'sf_client', 'sf_pull',
                        'sf_contact_pull', 'sf_opportunity_pull', 'sf_webhook',
                        'crypto_helper'):
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
                if 'lambda_function' in sys.modules:
                    del sys.modules['lambda_function']


def _mock_conn():
    cur = MagicMock()
    cur.fetchone.return_value = None
    cur.fetchall.return_value = []
    conn = MagicMock()
    conn.cursor.return_value = cur
    return conn, cur


ACCOUNT_USER_42 = {
    'user_id': 'u-1', 'email': 'a@a.com', 'name': 'Admin',
    'role': 'partner', 'is_admin': False, 'is_account': True, 'is_client': False,
    'account_id': 42, 'account_role': 'account_admin', 'client_id': None,
}


# ──────────────────────────────────────────────
# GET /salesforce/conflicts
# ──────────────────────────────────────────────

class TestHandleConflicts:
    def test_lists_unresolved_scoped_to_account(self, sf_module):
        conn, cur = _mock_conn()
        cur.fetchall.return_value = [
            (1, 'client', 'c-uuid-1', '001-A',
             json.dumps(['Name']), json.dumps([{'field': 'Name'}]),
             None, 'Acme Corp'),
            (2, 'engagement', 'e-uuid-1', '006-A',
             json.dumps(['stage']), json.dumps([{'field': 'stage'}]),
             None, 'Project Phoenix'),
        ]
        with patch.object(sf_module, 'get_db_connection', return_value=conn), \
             patch.object(sf_module, 'require_auth',
                          return_value=(ACCOUNT_USER_42, None)):
            event = {'httpMethod': 'GET', 'path': '/salesforce/conflicts',
                     'headers': {'Authorization': 'Bearer x'}}
            response = sf_module.lambda_handler(event, None)
        assert response['statusCode'] == 200
        body = json.loads(response['body'])
        assert len(body['conflicts']) == 2
        # The SELECT WHERE clause MUST scope to account_id from JWT
        executed = [c for c in cur.execute.call_args_list
                    if 'salesforce_sync_log' in c.args[0]]
        assert executed
        params = executed[0].args[1]
        assert params[0] == 42  # JWT account_id

    def test_excludes_resolved_via_details_like(self, sf_module):
        """The 'resolved_at' marker in details JSON is what filters out
        resolved conflicts — verify the SQL uses NOT LIKE '%resolved_at%'."""
        conn, cur = _mock_conn()
        cur.fetchall.return_value = []
        with patch.object(sf_module, 'get_db_connection', return_value=conn), \
             patch.object(sf_module, 'require_auth',
                          return_value=(ACCOUNT_USER_42, None)):
            event = {'httpMethod': 'GET', 'path': '/salesforce/conflicts',
                     'headers': {'Authorization': 'Bearer x'}}
            sf_module.lambda_handler(event, None)
        executed = [c for c in cur.execute.call_args_list
                    if 'salesforce_sync_log' in c.args[0]]
        sql = executed[0].args[0]
        params = executed[0].args[1]
        assert 'NOT LIKE' in sql
        assert '%resolved_at%' in params

    def test_returns_record_label_from_join(self, sf_module):
        """Conflicts response includes record_label (client.company_name
        or engagement.name) via the LEFT JOIN."""
        conn, cur = _mock_conn()
        cur.fetchall.return_value = [(
            1, 'client', 'c-uuid-1', '001-A',
            json.dumps([]), json.dumps([]), None, 'Acme Corp'
        )]
        with patch.object(sf_module, 'get_db_connection', return_value=conn), \
             patch.object(sf_module, 'require_auth',
                          return_value=(ACCOUNT_USER_42, None)):
            event = {'httpMethod': 'GET', 'path': '/salesforce/conflicts',
                     'headers': {'Authorization': 'Bearer x'}}
            response = sf_module.lambda_handler(event, None)
        body = json.loads(response['body'])
        assert body['conflicts'][0]['record_label'] == 'Acme Corp'


# ──────────────────────────────────────────────
# POST /salesforce/conflicts/{log_id}/resolve
# ──────────────────────────────────────────────

class TestResolveConflict:
    def test_requires_valid_resolution_enum(self, sf_module):
        conn, _ = _mock_conn()
        with patch.object(sf_module, 'get_db_connection', return_value=conn), \
             patch.object(sf_module, 'require_auth',
                          return_value=(ACCOUNT_USER_42, None)):
            event = {
                'httpMethod': 'POST',
                'path': '/salesforce/conflicts/1/resolve',
                'pathParameters': {'log_id': '1'},
                'headers': {'Authorization': 'Bearer x'},
                'body': json.dumps({'resolution': 'invalid'}),
            }
            response = sf_module.lambda_handler(event, None)
        assert response['statusCode'] == 400

    def test_unknown_log_id_returns_404(self, sf_module):
        conn, cur = _mock_conn()
        cur.fetchone.return_value = None  # log row missing
        with patch.object(sf_module, 'get_db_connection', return_value=conn), \
             patch.object(sf_module, 'require_auth',
                          return_value=(ACCOUNT_USER_42, None)):
            event = {
                'httpMethod': 'POST',
                'path': '/salesforce/conflicts/999/resolve',
                'pathParameters': {'log_id': '999'},
                'headers': {'Authorization': 'Bearer x'},
                'body': json.dumps({'resolution': 'keep_xo'}),
            }
            response = sf_module.lambda_handler(event, None)
        assert response['statusCode'] == 404

    def test_already_resolved_returns_409(self, sf_module):
        conn, cur = _mock_conn()
        # First fetchone: log row exists, details ALREADY has resolved_at marker.
        cur.fetchone.return_value = (
            'client', 'c-uuid-1', '001-A',
            json.dumps({'diffs': [], 'resolved_at': '2026-05-14T12:00:00Z'}),
        )
        with patch.object(sf_module, 'get_db_connection', return_value=conn), \
             patch.object(sf_module, 'require_auth',
                          return_value=(ACCOUNT_USER_42, None)):
            event = {
                'httpMethod': 'POST',
                'path': '/salesforce/conflicts/1/resolve',
                'pathParameters': {'log_id': '1'},
                'headers': {'Authorization': 'Bearer x'},
                'body': json.dumps({'resolution': 'keep_xo'}),
            }
            response = sf_module.lambda_handler(event, None)
        assert response['statusCode'] == 409

    def test_cross_tenant_log_id_returns_404(self, sf_module):
        """A conflict belonging to a different account_id must not be
        resolvable by this user. The SELECT in the handler filters by
        (id=log_id AND account_id=JWT) — if the row exists under a
        different account, the JOIN returns no rows → 404."""
        conn, cur = _mock_conn()
        cur.fetchone.return_value = None
        with patch.object(sf_module, 'get_db_connection', return_value=conn), \
             patch.object(sf_module, 'require_auth',
                          return_value=(ACCOUNT_USER_42, None)):
            event = {
                'httpMethod': 'POST',
                'path': '/salesforce/conflicts/1/resolve',
                'pathParameters': {'log_id': '1'},
                'headers': {'Authorization': 'Bearer x'},
                'body': json.dumps({'resolution': 'keep_xo'}),
            }
            sf_module.lambda_handler(event, None)
        # Verify the SELECT bound account_id=42 from the JWT.
        selects = [c for c in cur.execute.call_args_list
                   if 'salesforce_sync_log' in c.args[0]
                   and 'sync_direction' in c.args[0]
                   and 'SELECT' in c.args[0]]
        assert selects
        params = selects[0].args[1]
        assert params[1] == 42  # account_id scope


# ──────────────────────────────────────────────
# GET /salesforce/status — PR 4 extension
# ──────────────────────────────────────────────

class TestStatusExtended:
    def test_disconnected_returns_pull_timestamps_and_conflict_count(self, sf_module):
        conn, cur = _mock_conn()
        cur.fetchone.return_value = (3,)  # COUNT(*) unresolved_conflicts
        with patch.object(sf_module, 'get_db_connection', return_value=conn), \
             patch.object(sf_module, 'require_auth',
                          return_value=(ACCOUNT_USER_42, None)), \
             patch.object(sf_module, 'read_account_tokens', return_value=None), \
             patch.object(sf_module, 'get_account_config',
                          side_effect=lambda c, aid, k: {
                              'salesforce_account_last_pull_at': '2026-04-15T10:00:00Z',
                              'salesforce_contact_last_pull_at': '2026-04-16T11:00:00Z',
                              'salesforce_opportunity_last_pull_at': None,
                          }.get(k)):
            event = {'httpMethod': 'GET', 'path': '/salesforce/status',
                     'headers': {'Authorization': 'Bearer x'}}
            response = sf_module.lambda_handler(event, None)
        body = json.loads(response['body'])
        assert body['connected'] is False
        assert body['last_pull_at'] == '2026-04-16T11:00:00Z'  # max of the three
        assert body['unresolved_conflicts'] == 3

    def test_token_expired_surfaces_marker(self, sf_module):
        """401 from the lightweight /limits/ probe becomes
        error='token_expired' so the frontend can show the Reconnect banner."""
        conn, cur = _mock_conn()
        cur.fetchone.return_value = (0,)
        with patch.object(sf_module, 'get_db_connection', return_value=conn), \
             patch.object(sf_module, 'require_auth',
                          return_value=(ACCOUNT_USER_42, None)), \
             patch.object(sf_module, 'read_account_tokens',
                          return_value={'access_token': 'AT',
                                        'refresh_token': 'RT',
                                        'instance_url': 'https://x/sf'}), \
             patch.object(sf_module, 'get_account_config', return_value=None), \
             patch.object(sf_module, 'sf_call_with_refresh',
                          return_value=(401, {'message': 'invalid session'})):
            event = {'httpMethod': 'GET', 'path': '/salesforce/status',
                     'headers': {'Authorization': 'Bearer x'}}
            response = sf_module.lambda_handler(event, None)
        body = json.loads(response['body'])
        assert body['connected'] is False
        assert body['error'] == 'token_expired'

    def test_connected_returns_unresolved_count_scoped_to_account(self, sf_module):
        conn, cur = _mock_conn()
        cur.fetchone.return_value = (5,)
        with patch.object(sf_module, 'get_db_connection', return_value=conn), \
             patch.object(sf_module, 'require_auth',
                          return_value=(ACCOUNT_USER_42, None)), \
             patch.object(sf_module, 'read_account_tokens',
                          return_value={'access_token': 'AT',
                                        'refresh_token': 'RT',
                                        'instance_url': 'https://x/sf'}), \
             patch.object(sf_module, 'get_account_config', return_value=None), \
             patch.object(sf_module, 'sf_call_with_refresh',
                          return_value=(200, {'DailyApiRequests': {'Max': 15000}})):
            event = {'httpMethod': 'GET', 'path': '/salesforce/status',
                     'headers': {'Authorization': 'Bearer x'}}
            response = sf_module.lambda_handler(event, None)
        body = json.loads(response['body'])
        assert body['connected'] is True
        assert body['unresolved_conflicts'] == 5
        # The COUNT query MUST be scoped to JWT account_id.
        count_queries = [
            c for c in cur.execute.call_args_list
            if 'COUNT' in c.args[0] and 'salesforce_sync_log' in c.args[0]
        ]
        assert count_queries
        assert count_queries[0].args[1][0] == 42  # account_id
