"""
Regression tests for shared/integrations_config.py — the account-scoped
credential storage and OAuth nonce helper for Salesforce and Gong.

Validation gates per Stage 0 plan:
  - Tenant leak: get_account_config(A) cannot return a row written for B
  - Resolver fallback: client_integrations missing/NULL → account-level
  - OAuth nonce: 10-min TTL, single-use, expired-nonce rejection
  - Required account_id: NULL is reserved for HubSpot, must raise
"""

import os
import sys
import base64
import importlib
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, ANY

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))

TEST_MASTER_KEY = base64.b64encode(os.urandom(32)).decode()


@pytest.fixture
def integrations_config(monkeypatch):
    """Fresh module import with a real master key so encrypt/decrypt roundtrip works."""
    monkeypatch.setenv('AES_MASTER_KEY', TEST_MASTER_KEY)
    import crypto_helper
    importlib.reload(crypto_helper)
    if 'integrations_config' in sys.modules:
        del sys.modules['integrations_config']
    import integrations_config as ic
    yield ic


@pytest.fixture
def mock_conn():
    """psycopg2 connection mock; cursor returned by .cursor() is also returned by
    the fixture so tests can configure fetchone/fetchall and inspect execute calls."""
    cur = MagicMock()
    cur.fetchone.return_value = None
    cur.fetchall.return_value = []
    conn = MagicMock()
    conn.cursor.return_value = cur
    return conn, cur


# ──────────────────────────────────────────────
# Required account_id — NULL is reserved for HubSpot's legacy path
# ──────────────────────────────────────────────

class TestAccountIdRequired:
    def test_set_account_config_rejects_none(self, integrations_config, mock_conn):
        conn, _ = mock_conn
        with pytest.raises(ValueError, match="account_id is required"):
            integrations_config.set_account_config(conn, None, 'k', 'v')

    def test_get_account_config_rejects_none(self, integrations_config, mock_conn):
        conn, _ = mock_conn
        with pytest.raises(ValueError, match="account_id is required"):
            integrations_config.get_account_config(conn, None, 'k')

    def test_delete_account_config_rejects_none(self, integrations_config, mock_conn):
        conn, _ = mock_conn
        with pytest.raises(ValueError, match="account_id is required"):
            integrations_config.delete_account_config(conn, None, 'k')


# ──────────────────────────────────────────────
# Tenant leak — account_id MUST scope every read and write
# ──────────────────────────────────────────────

class TestTenantIsolation:
    def test_set_account_config_includes_account_id_in_sql(self, integrations_config, mock_conn):
        conn, cur = mock_conn
        integrations_config.set_account_config(conn, 42, 'salesforce_access_token', 'token_value')

        sql, params = cur.execute.call_args[0]
        assert 'account_id' in sql.lower()
        # First param must be the account_id, not the key
        assert params[0] == 42
        assert params[1] == 'salesforce_access_token'

    def test_get_account_config_scopes_by_account_id(self, integrations_config, mock_conn):
        conn, cur = mock_conn
        cur.fetchone.return_value = None
        integrations_config.get_account_config(conn, 42, 'salesforce_access_token')

        sql, params = cur.execute.call_args[0]
        assert 'account_id = %s' in sql.lower()
        assert params == (42, 'salesforce_access_token')

    def test_two_accounts_same_key_emit_different_account_ids(
            self, integrations_config, mock_conn):
        """The core tenant-leak gate: writes for account A and account B
        emit account_id=A and account_id=B respectively for the same config_key."""
        conn, cur = mock_conn
        integrations_config.set_account_config(conn, 1, 'salesforce_access_token', 'v1')
        params_a = cur.execute.call_args[0][1]

        integrations_config.set_account_config(conn, 2, 'salesforce_access_token', 'v2')
        params_b = cur.execute.call_args[0][1]

        assert params_a[0] == 1
        assert params_b[0] == 2
        # And the encrypted values must differ — confirms encryption is per-write,
        # not deterministic (no oracle on whether two accounts hold the same secret).
        assert params_a[2] != params_b[2]

    def test_get_returns_none_when_account_row_absent(self, integrations_config, mock_conn):
        conn, cur = mock_conn
        cur.fetchone.return_value = None
        result = integrations_config.get_account_config(conn, 42, 'salesforce_access_token')
        assert result is None


# ──────────────────────────────────────────────
# Encryption roundtrip — values written must survive a read
# ──────────────────────────────────────────────

class TestEncryptionRoundtrip:
    def test_encrypted_value_decrypts_on_read(self, integrations_config, mock_conn):
        conn, cur = mock_conn

        integrations_config.set_account_config(conn, 42, 'k', 'sf_secret_xyz')
        written_encrypted = cur.execute.call_args[0][1][2]

        # The value going into the DB is not the plaintext.
        assert written_encrypted != 'sf_secret_xyz'

        # Now simulate reading that row back.
        cur.fetchone.return_value = (written_encrypted,)
        result = integrations_config.get_account_config(conn, 42, 'k')
        assert result == 'sf_secret_xyz'

    def test_none_value_stored_as_null(self, integrations_config, mock_conn):
        conn, cur = mock_conn
        integrations_config.set_account_config(conn, 42, 'k', None)
        params = cur.execute.call_args[0][1]
        assert params[2] is None


# ──────────────────────────────────────────────
# Resolver fallback — partner-first, account-level second
# ──────────────────────────────────────────────

class TestResolveIntegrationConfig:
    def test_partner_row_takes_priority(self, integrations_config, mock_conn):
        conn, cur = mock_conn
        # client_integrations row with populated SF columns
        encrypted_access = integrations_config.encrypt('partner_token')
        encrypted_refresh = integrations_config.encrypt('partner_refresh')
        cur.fetchone.return_value = (
            'https://partner.my.salesforce.com',   # salesforce_instance_url
            None,                                  # salesforce_token_expiry
            None,                                  # salesforce_connected_by
            None,                                  # salesforce_connected_at
            encrypted_access,                      # salesforce_access_token_encrypted
            encrypted_refresh,                     # salesforce_refresh_token_encrypted
        )

        result = integrations_config.resolve_integration_config(
            conn, 'client-uuid-1', 'salesforce', account_id=42
        )

        assert result is not None
        assert result['salesforce_instance_url'] == 'https://partner.my.salesforce.com'
        assert result['salesforce_access_token'] == 'partner_token'
        assert result['salesforce_refresh_token'] == 'partner_refresh'
        # _encrypted suffix must be stripped from returned keys
        assert 'salesforce_access_token_encrypted' not in result

    def test_falls_back_to_account_when_no_client_row(self, integrations_config, mock_conn):
        conn, cur = mock_conn
        # First call (client_integrations SELECT) returns None.
        # Subsequent calls (account-level reads) return encrypted values.
        encrypted_token = integrations_config.encrypt('team_token')

        def fetchone_side_effect():
            calls = cur.execute.call_args_list
            last_sql = calls[-1][0][0].lower()
            if 'client_integrations' in last_sql:
                return None
            if 'salesforce_access_token' in calls[-1][0][1]:
                return (encrypted_token,)
            return None
        cur.fetchone.side_effect = lambda: fetchone_side_effect()

        result = integrations_config.resolve_integration_config(
            conn, 'client-uuid-1', 'salesforce', account_id=42
        )

        assert result is not None
        assert result['salesforce_access_token'] == 'team_token'

    def test_falls_back_when_client_row_all_null(self, integrations_config, mock_conn):
        conn, cur = mock_conn
        encrypted_token = integrations_config.encrypt('team_token')

        call_count = {'n': 0}
        def fetchone_side_effect():
            call_count['n'] += 1
            if call_count['n'] == 1:
                # client_integrations row exists but every column is NULL
                return (None, None, None, None, None, None)
            calls = cur.execute.call_args_list
            if 'salesforce_access_token' in calls[-1][0][1]:
                return (encrypted_token,)
            return None
        cur.fetchone.side_effect = lambda: fetchone_side_effect()

        result = integrations_config.resolve_integration_config(
            conn, 'client-uuid-1', 'salesforce', account_id=42
        )
        assert result is not None
        assert result['salesforce_access_token'] == 'team_token'

    def test_returns_none_when_neither_partner_nor_account(self, integrations_config, mock_conn):
        conn, cur = mock_conn
        cur.fetchone.return_value = None  # every query returns nothing
        result = integrations_config.resolve_integration_config(
            conn, 'client-uuid-1', 'salesforce', account_id=42
        )
        assert result is None

    def test_unknown_integration_raises(self, integrations_config, mock_conn):
        conn, _ = mock_conn
        with pytest.raises(ValueError, match="Unknown integration"):
            integrations_config.resolve_integration_config(
                conn, 'client-uuid-1', 'bogus', account_id=42
            )


# ──────────────────────────────────────────────
# get_client_integration — direct partner-row reads
# ──────────────────────────────────────────────

class TestGetClientIntegration:
    def test_returns_none_when_no_row(self, integrations_config, mock_conn):
        conn, cur = mock_conn
        cur.fetchone.return_value = None
        assert integrations_config.get_client_integration(conn, 'c', 'salesforce') is None

    def test_returns_none_when_all_columns_null(self, integrations_config, mock_conn):
        conn, cur = mock_conn
        cur.fetchone.return_value = (None,) * 6
        assert integrations_config.get_client_integration(conn, 'c', 'salesforce') is None

    def test_gong_returns_decrypted_secrets(self, integrations_config, mock_conn):
        conn, cur = mock_conn
        ek = integrations_config.encrypt('access_key_xyz')
        eks = integrations_config.encrypt('access_secret_xyz')
        ews = integrations_config.encrypt('webhook_secret_xyz')
        cur.fetchone.return_value = (
            'gong-workspace-1',  # gong_workspace_id
            None,                # gong_connected_by
            None,                # gong_connected_at
            ek,                  # gong_access_key_encrypted
            eks,                 # gong_access_key_secret_encrypted
            ews,                 # gong_webhook_secret_encrypted
        )
        result = integrations_config.get_client_integration(conn, 'c', 'gong')
        assert result['gong_workspace_id'] == 'gong-workspace-1'
        assert result['gong_access_key'] == 'access_key_xyz'
        assert result['gong_access_key_secret'] == 'access_secret_xyz'
        assert result['gong_webhook_secret'] == 'webhook_secret_xyz'


# ──────────────────────────────────────────────
# OAuth nonce — 10 min TTL, single-use, expired rejection
# ──────────────────────────────────────────────

class TestOAuthNonce:
    def test_create_nonce_inserts_row_with_10_min_expiry(self, integrations_config, mock_conn):
        conn, cur = mock_conn
        before = datetime.now(timezone.utc)
        nonce = integrations_config.create_oauth_nonce(
            conn, account_id=42, user_id='u', integration='salesforce'
        )
        after = datetime.now(timezone.utc)

        # First execute: prune expired rows. Second execute: insert new nonce.
        assert cur.execute.call_count == 2
        prune_sql = cur.execute.call_args_list[0][0][0].lower()
        assert 'delete from oauth_state_nonces' in prune_sql
        assert 'expires_at < now()' in prune_sql

        insert_sql, insert_params = cur.execute.call_args_list[1][0]
        assert 'insert into oauth_state_nonces' in insert_sql.lower()
        # params: (nonce, account_id, client_id, user_id, integration, expires_at)
        assert insert_params[0] == nonce
        assert insert_params[1] == 42
        assert insert_params[2] is None
        assert insert_params[3] == 'u'
        assert insert_params[4] == 'salesforce'
        expires_at = insert_params[5]
        delta = expires_at - before
        # 10-minute TTL with a tolerance for fixture overhead
        assert timedelta(minutes=9, seconds=55) <= delta <= timedelta(minutes=10, seconds=5)

    def test_create_nonce_rejects_none_account_id(self, integrations_config, mock_conn):
        conn, _ = mock_conn
        with pytest.raises(ValueError):
            integrations_config.create_oauth_nonce(
                conn, account_id=None, user_id='u', integration='salesforce'
            )

    def test_create_nonce_rejects_unknown_integration(self, integrations_config, mock_conn):
        conn, _ = mock_conn
        with pytest.raises(ValueError, match="Unknown integration"):
            integrations_config.create_oauth_nonce(
                conn, account_id=42, user_id='u', integration='hubspot'
            )

    def test_nonces_are_unique(self, integrations_config, mock_conn):
        conn, _ = mock_conn
        n1 = integrations_config.create_oauth_nonce(conn, 42, 'u', 'salesforce')
        n2 = integrations_config.create_oauth_nonce(conn, 42, 'u', 'salesforce')
        assert n1 != n2
        assert len(n1) >= 32

    def test_consume_valid_nonce_returns_payload(self, integrations_config, mock_conn):
        conn, cur = mock_conn
        future = datetime.now(timezone.utc) + timedelta(minutes=5)
        cur.fetchone.return_value = (42, None, 'user-uuid', 'salesforce', future)

        result = integrations_config.consume_oauth_nonce(conn, 'nonce-abc')

        assert result == {
            'account_id': 42,
            'client_id': None,
            'user_id': 'user-uuid',
            'integration': 'salesforce',
        }
        # The query MUST be DELETE...RETURNING — single-use, atomic consume
        sql = cur.execute.call_args[0][0].lower()
        assert 'delete from oauth_state_nonces' in sql
        assert 'returning' in sql

    def test_consume_unknown_nonce_returns_none(self, integrations_config, mock_conn):
        conn, cur = mock_conn
        cur.fetchone.return_value = None
        assert integrations_config.consume_oauth_nonce(conn, 'no-such-nonce') is None

    def test_consume_expired_nonce_returns_none(self, integrations_config, mock_conn):
        """Even if a row somehow survives the opportunistic prune, an expired
        nonce must never be honored by consume — defense in depth."""
        conn, cur = mock_conn
        past = datetime.now(timezone.utc) - timedelta(seconds=1)
        cur.fetchone.return_value = (42, None, 'user-uuid', 'salesforce', past)
        assert integrations_config.consume_oauth_nonce(conn, 'expired-nonce') is None
