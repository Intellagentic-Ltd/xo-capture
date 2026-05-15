"""
XO Platform — Cross-tenant client access (PR 3.4).

Single source of truth for "which clients can this user see / write to?"
Used everywhere a lambda reads or writes a clients-related row.

ACCESS MODEL (Ken's Option 1, locked PR 3.4):
  super_admin / is_admin   → all clients, no filter
  account_admin            → clients in own account OR shared with own account
                             (account-level share via client_shares)
  account_user / contributor / client_contact (with JWT.account_id):
                             only clients assigned via user_client_assignments.
                             UCA rows may point at clients OWNED by another
                             account when a share grant exists — Joe Lopez
                             assigns shared clients to his reps explicitly.
  is_client (legacy JWT.client_id):
                             only the single client whose s3_folder matches.
  legacy is_account (no account_role): own account only, no shares.
                             (Transition path; not extended to shares because
                             we can't tell admin vs user without account_role.)

API:
  clients_where_fragment(user, alias='c')
    -> (sql_fragment_without_WHERE_keyword, params_tuple)
    Caller plugs into existing query:
        WHERE (existing) AND ({frag})
    or as the only filter:
        WHERE ({frag})

  can_user_access_client(conn, user, client_id, write=False)
    -> bool
    Used at write boundaries and one-off reads. write=True requires either
    ownership, a 'read_write' share, or super_admin. Reads accept any share
    (read_only or read_write).
"""

from typing import Tuple


def _is_super(user):
    return user.get('is_admin') or user.get('account_role') == 'super_admin'


def clients_where_fragment(user, alias: str = 'c') -> Tuple[str, tuple]:
    """Return (sql_fragment, params) restricting a clients query to rows
    accessible by `user`. Fragment does NOT include the WHERE keyword.

    Examples:
      where, params = clients_where_fragment(user)
      cur.execute(f"SELECT ... FROM clients c WHERE {where}", params)

      where, params = clients_where_fragment(user, alias='cl')
      cur.execute(f"SELECT ... FROM clients cl WHERE cl.status = %s AND {where}",
                  ('active',) + params)
    """
    account_role = user.get('account_role')
    aid = user.get('account_id')
    uid = user.get('user_id')

    if _is_super(user):
        return ('TRUE', ())

    if account_role == 'account_admin':
        # Own account OR shared with own account.
        return (
            f"({alias}.account_id = %s OR {alias}.id IN ("
            "SELECT client_id FROM client_shares "
            "WHERE shared_with_account_id = %s))",
            (aid, aid),
        )

    if account_role in ('account_user', 'client_contact', 'contributor'):
        # UCA-scoped. Shares do not propagate to scoped users automatically;
        # the account_admin must add a UCA row for the shared client. The UCA
        # insert path (handle_assign_client_to_user) is relaxed to permit
        # cross-account client_id values when a share exists.
        return (
            f"{alias}.id IN (SELECT client_id FROM user_client_assignments "
            "WHERE user_id = %s)",
            (uid,),
        )

    if user.get('is_account') and aid:
        # Legacy partner user fallback. No share extension — see module
        # docstring rationale (can't distinguish admin vs user without role).
        return (f"{alias}.account_id = %s", (aid,))

    if user.get('is_client') and user.get('client_id'):
        return (f"{alias}.s3_folder = %s", (user['client_id'],))

    # Last-resort fallback (legacy single-user path).
    return (f"{alias}.user_id = %s", (uid,))


def can_user_access_client(conn, user, client_id, write: bool = False) -> bool:
    """Boolean access check. Use at write boundaries and one-off reads.

    write=True semantics:
      - super_admin: always true
      - ownership (and required role per UCA gating below): true if not blocked
      - share grant: requires permissions='read_write'
    write=False (read) accepts both 'read_only' and 'read_write' shares.
    """
    if _is_super(user):
        return True

    cur = conn.cursor()
    try:
        cur.execute("SELECT account_id FROM clients WHERE id = %s", (client_id,))
        row = cur.fetchone()
        if not row:
            return False
        owning_account_id = row[0]

        account_role = user.get('account_role')
        uid = user.get('user_id')
        aid = user.get('account_id')

        # Ownership branch.
        if aid is not None and aid == owning_account_id:
            # account_admin and legacy is_account get unconditional access
            # within the owning account.
            if account_role == 'account_admin' or (
                user.get('is_account') and not account_role
            ):
                return True
            # account_user / contributor / client_contact need a UCA row.
            if account_role in ('account_user', 'client_contact', 'contributor'):
                cur.execute(
                    "SELECT 1 FROM user_client_assignments "
                    "WHERE user_id = %s AND client_id = %s",
                    (uid, client_id),
                )
                return cur.fetchone() is not None
            # client_contact via JWT.client_id (no account_role)
            if user.get('is_client') and user.get('client_id'):
                cur.execute(
                    "SELECT s3_folder FROM clients WHERE id = %s",
                    (client_id,),
                )
                row2 = cur.fetchone()
                return bool(row2 and row2[0] == user.get('client_id'))
            return False

        # Cross-tenant — share grant required.
        if aid is None:
            return False
        cur.execute(
            "SELECT permissions FROM client_shares "
            "WHERE client_id = %s AND shared_with_account_id = %s",
            (client_id, aid),
        )
        share_row = cur.fetchone()
        if not share_row:
            return False
        permissions = share_row[0]
        if write and permissions != 'read_write':
            return False

        # For account_user etc, also require a UCA row (the recipient
        # account_admin must explicitly assign the shared client to the rep).
        if account_role in ('account_user', 'client_contact', 'contributor'):
            cur.execute(
                "SELECT 1 FROM user_client_assignments "
                "WHERE user_id = %s AND client_id = %s",
                (uid, client_id),
            )
            return cur.fetchone() is not None

        # account_admin (or legacy is_account) in the recipient tenant: share is enough.
        return account_role == 'account_admin' or (
            user.get('is_account') and not account_role
        )
    finally:
        cur.close()
