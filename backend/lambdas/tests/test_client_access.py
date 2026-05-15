"""
Unit tests for shared/client_access.py — the single source of truth for
cross-tenant client access (PR 3.4).

Coverage:
  - clients_where_fragment for every JWT role
  - clients_where_fragment includes the share OR clause for account_admin
  - clients_where_fragment table-alias safe
  - can_user_access_client ownership branch (every role within owning account)
  - can_user_access_client cross-tenant via share (read + write semantics)
  - can_user_access_client UCA gating for account_user / contributor
  - can_user_access_client returns False for unknown client_id
"""

import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))

from client_access import clients_where_fragment, can_user_access_client


# ──────────────────────────────────────────────
# User dict builders
# ──────────────────────────────────────────────

def _user(role=None, account_id=None, user_id='u-1', is_admin=False,
          is_account=False, is_client=False, client_id=None):
    return {
        'user_id': user_id,
        'account_id': account_id,
        'account_role': role,
        'is_admin': is_admin,
        'is_account': is_account,
        'is_client': is_client,
        'client_id': client_id,
    }


# ──────────────────────────────────────────────
# clients_where_fragment
# ──────────────────────────────────────────────

class TestWhereFragmentRoleBranches:
    def test_super_admin_returns_true(self):
        sql, params = clients_where_fragment(_user(role='super_admin'))
        assert sql == 'TRUE'
        assert params == ()

    def test_is_admin_returns_true(self):
        sql, params = clients_where_fragment(_user(is_admin=True))
        assert sql == 'TRUE'
        assert params == ()

    def test_account_admin_owns_or_shared(self):
        sql, params = clients_where_fragment(_user(role='account_admin', account_id=42))
        # Two account_id binds — one for own account, one for share lookup.
        assert 'c.account_id = %s' in sql
        assert 'client_shares' in sql
        assert 'shared_with_account_id = %s' in sql
        assert params == (42, 42)

    def test_account_user_uca_only_no_share_propagation(self):
        sql, params = clients_where_fragment(_user(role='account_user',
                                                   account_id=42, user_id='u-7'))
        # Shares do NOT auto-propagate to account_users — UCA only.
        assert 'user_client_assignments' in sql
        assert 'client_shares' not in sql
        assert params == ('u-7',)

    def test_contributor_uca_only(self):
        sql, params = clients_where_fragment(_user(role='contributor',
                                                   account_id=42, user_id='u-8'))
        assert 'user_client_assignments' in sql
        assert params == ('u-8',)

    def test_client_contact_role_uca_only(self):
        sql, params = clients_where_fragment(_user(role='client_contact',
                                                   account_id=42, user_id='u-9'))
        assert 'user_client_assignments' in sql
        assert params == ('u-9',)

    def test_legacy_is_account_no_share_extension(self):
        sql, params = clients_where_fragment(_user(is_account=True, account_id=42))
        # Legacy path — own account only, no share OR. See helper docstring.
        assert 'c.account_id = %s' in sql
        assert 'client_shares' not in sql
        assert params == (42,)

    def test_is_client_s3_folder_match(self):
        sql, params = clients_where_fragment(_user(is_client=True, client_id='my-folder'))
        assert 's3_folder' in sql
        assert params == ('my-folder',)

    def test_last_resort_fallback_user_id(self):
        sql, params = clients_where_fragment(_user(user_id='u-x'))
        assert 'c.user_id = %s' in sql
        assert params == ('u-x',)


class TestWhereFragmentAlias:
    def test_alias_substitution(self):
        sql, _ = clients_where_fragment(_user(role='account_admin', account_id=42),
                                        alias='cl')
        assert 'cl.account_id' in sql
        assert 'cl.id IN' in sql
        assert 'c.account_id' not in sql

    def test_alias_substitution_for_uca_branch(self):
        sql, _ = clients_where_fragment(_user(role='account_user', user_id='u-1'),
                                        alias='cli')
        assert 'cli.id IN' in sql


# ──────────────────────────────────────────────
# can_user_access_client
# ──────────────────────────────────────────────

class TestAccessSuperAdmin:
    def test_super_admin_always_true(self):
        conn = MagicMock()
        assert can_user_access_client(conn, _user(is_admin=True), 'c-1') is True
        # No DB call needed for super admin.
        conn.cursor.assert_not_called()


class TestAccessOwnership:
    def _setup(self, client_account_id, extra_rows=None):
        cur = MagicMock()
        rows = [(client_account_id,)] + (extra_rows or [])
        cur.fetchone.side_effect = rows
        conn = MagicMock()
        conn.cursor.return_value = cur
        return conn, cur

    def test_account_admin_owns_client_true(self):
        conn, _ = self._setup(client_account_id=42)
        user = _user(role='account_admin', account_id=42)
        assert can_user_access_client(conn, user, 'c-1') is True

    def test_account_admin_other_account_no_share_false(self):
        # First fetch: client.account_id=99 (different from user's 42)
        # Second fetch: share lookup returns None
        conn, _ = self._setup(client_account_id=99, extra_rows=[None])
        user = _user(role='account_admin', account_id=42)
        assert can_user_access_client(conn, user, 'c-1') is False

    def test_account_user_within_own_account_requires_uca(self):
        # client.account_id=42 matches user, UCA returns 1 row
        conn, _ = self._setup(client_account_id=42, extra_rows=[(1,)])
        user = _user(role='account_user', account_id=42, user_id='u-7')
        assert can_user_access_client(conn, user, 'c-1') is True

    def test_account_user_within_own_account_no_uca_false(self):
        conn, _ = self._setup(client_account_id=42, extra_rows=[None])
        user = _user(role='account_user', account_id=42, user_id='u-7')
        assert can_user_access_client(conn, user, 'c-1') is False

    def test_legacy_is_account_in_owning_account_true(self):
        conn, _ = self._setup(client_account_id=42)
        user = _user(is_account=True, account_id=42)
        assert can_user_access_client(conn, user, 'c-1') is True


class TestAccessUnknownClient:
    def test_returns_false(self):
        cur = MagicMock()
        cur.fetchone.return_value = None
        conn = MagicMock()
        conn.cursor.return_value = cur
        user = _user(role='account_admin', account_id=42)
        assert can_user_access_client(conn, user, 'no-such-id') is False


class TestAccessCrossTenantShare:
    def _setup(self, owning_account_id, share_perm=None, uca_present=False):
        cur = MagicMock()
        rows = [(owning_account_id,)]
        # share lookup returns perm or None
        rows.append((share_perm,) if share_perm else None)
        if uca_present is not None:
            rows.append((1,) if uca_present else None)
        cur.fetchone.side_effect = rows
        conn = MagicMock()
        conn.cursor.return_value = cur
        return conn, cur

    def test_account_admin_with_read_write_share_read_true(self):
        conn, _ = self._setup(owning_account_id=99, share_perm='read_write')
        user = _user(role='account_admin', account_id=42)
        assert can_user_access_client(conn, user, 'c-1', write=False) is True

    def test_account_admin_with_read_write_share_write_true(self):
        conn, _ = self._setup(owning_account_id=99, share_perm='read_write')
        user = _user(role='account_admin', account_id=42)
        assert can_user_access_client(conn, user, 'c-1', write=True) is True

    def test_account_admin_with_read_only_share_write_false(self):
        """LOAD-BEARING: a read_only share grant must not authorize a write."""
        conn, _ = self._setup(owning_account_id=99, share_perm='read_only')
        user = _user(role='account_admin', account_id=42)
        assert can_user_access_client(conn, user, 'c-1', write=True) is False

    def test_account_admin_with_read_only_share_read_true(self):
        conn, _ = self._setup(owning_account_id=99, share_perm='read_only')
        user = _user(role='account_admin', account_id=42)
        assert can_user_access_client(conn, user, 'c-1', write=False) is True

    def test_no_share_cross_tenant_false(self):
        conn, _ = self._setup(owning_account_id=99, share_perm=None)
        user = _user(role='account_admin', account_id=42)
        assert can_user_access_client(conn, user, 'c-1') is False


class TestAccessCrossTenantShareWithUCA:
    """account_user in recipient account: share alone is not enough — UCA required."""

    def _setup(self, owning_account_id, share_perm, uca_present):
        cur = MagicMock()
        rows = [
            (owning_account_id,),                          # client.account_id
            (share_perm,) if share_perm else None,         # share lookup
            (1,) if uca_present else None,                 # UCA lookup
        ]
        cur.fetchone.side_effect = rows
        conn = MagicMock()
        conn.cursor.return_value = cur
        return conn, cur

    def test_share_plus_uca_true(self):
        conn, _ = self._setup(owning_account_id=99, share_perm='read_write',
                              uca_present=True)
        user = _user(role='account_user', account_id=42, user_id='u-7')
        assert can_user_access_client(conn, user, 'c-1', write=True) is True

    def test_share_no_uca_false(self):
        """LOAD-BEARING: share grants account-level visibility, but
        account_users still gated by UCA. Joe's reps don't see shared
        clients until he assigns them explicitly."""
        conn, _ = self._setup(owning_account_id=99, share_perm='read_write',
                              uca_present=False)
        user = _user(role='account_user', account_id=42, user_id='u-7')
        assert can_user_access_client(conn, user, 'c-1') is False

    def test_uca_without_share_false(self):
        """Defensive: a stale UCA row for a no-longer-shared cross-tenant
        client doesn't grant access. Share is the gate."""
        conn, _ = self._setup(owning_account_id=99, share_perm=None,
                              uca_present=True)
        user = _user(role='account_user', account_id=42, user_id='u-7')
        assert can_user_access_client(conn, user, 'c-1') is False
