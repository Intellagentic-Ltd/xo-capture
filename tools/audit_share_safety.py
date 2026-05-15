#!/usr/bin/env python3
"""
PR 3.4b — share-safety audit.

Scans the codebase for "naked" WHERE account_id = %s patterns on
clients-related tables. A naked pattern is one that filters by
account_id without also routing through shared/client_access (which
provides the cross-tenant share path).

WHAT IT CHECKS

For every production lambda module — backend/lambdas/**/lambda_function.py,
plus sibling .py files in each lambda dir (e.g. sf_pull.py, sf_webhook.py) —
flag lines that look like:

  WHERE ... account_id = %s ...
  AND   ... account_id = %s ...
  OR    ... account_id = %s ...

…when they apply to a clients-related query (FROM clients, JOIN clients,
UPDATE clients, FROM engagements c JOIN clients on c.id = ...). The audit
treats string literals as code (we want naked patterns flagged even when
they're hardcoded SQL strings).

WHAT IT INTENTIONALLY DOES NOT CHECK
  - /tests/ paths (tests routinely build raw SQL fixtures)
  - shared/client_access.py itself (it produces the fragments)
  - system_config queries (HubSpot's NULL-account namespace is intentional;
    not a clients-related table)
  - accounts table queries (different beast — managing tenants themselves)
  - Generic `account_id` references that don't tie back to clients
  - schema.sql (DDL, not access logic)

EXIT CODES
  0 — no naked queries on clients-related tables (or all flagged sites
      are pre-existing known auth gaps listed in DEFERRED_LINES below)
  1 — naked queries found; output prints file:line:snippet per finding,
      and the PR cannot proceed until either:
        (a) the site is migrated to use clients_where_fragment / can_user_access_client
        (b) the site is added to DEFERRED_LINES with a ticket reference

USAGE
  python3 tools/audit_share_safety.py
  python3 tools/audit_share_safety.py --verbose
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent

# Lines deferred to separate tickets — pre-existing auth gaps that are
# intentionally NOT fixed in PR 3.4b (per Ken's instruction).
#
# Format: (relative_path, line_number, ticket_summary)
# When a deferred line moves, update the line number here. When the gap is
# fixed in a future PR, remove the entry.
DEFERRED_LINES = {
    # Intentional ownership-only scopes — NOT auth gaps. These are partner-
    # role checks for magic-link / client_token operations in the auth lambda.
    # Sharing a client does NOT grant the recipient account the ability to
    # issue or revoke client_contact tokens for that client. Magic-link
    # operations stay with the OWNING account by design.
    #
    # If the product later decides to let share recipients issue magic links
    # too, the resolution is to remove these entries AND switch the query to
    # clients_where_fragment — not to leave the entry stale.
    ('backend/lambdas/auth/lambda_function.py', 862):
        'magic-link generation: partner ownership-only by design',
    ('backend/lambdas/auth/lambda_function.py', 939):
        'magic-link operation: partner ownership-only by design',
    ('backend/lambdas/auth/lambda_function.py', 1013):
        'magic-link operation: partner ownership-only by design',
    # PR 3.5: JOIN condition on client_salesforce_links (exempt table —
    # per-tenant SF mapping). The account_id = %s here binds csl.account_id,
    # not clients.account_id. The line is in the same query as the share-
    # aware `clients_where_fragment` access filter, so the join condition
    # is safe. The audit's table-detection finds 'FROM clients' first and
    # flags conservatively; this entry says "we checked, it's fine."
    ('backend/lambdas/salesforce-sync/sf_pull.py', 261):
        'join condition on client_salesforce_links (per-tenant SF mapping)',
}


# Files to skip — tests, the helper itself, migration scripts.
SKIP_PATTERNS = (
    '/tests/',
    '/shared/client_access.py',
    '/shared/migrate_',  # migration scripts run with admin context
    '/shared/copy_files.py',
    '__pycache__',
)


# Glob pattern for files to audit.
AUDIT_GLOBS = [
    'backend/lambdas/**/lambda_function.py',
    'backend/lambdas/salesforce-sync/sf_*.py',
]


# Regex: WHERE/AND/OR ... account_id = %s.
# Match account_id = %s in a SQL clause. Tolerant of leading WHERE/AND/OR.
NAKED_ACCOUNT_ID = re.compile(
    r'\b(?:WHERE|AND|OR)\b[^;]*?\baccount_id\s*=\s*%s',
    re.IGNORECASE,
)

# Tables that are clients-related (i.e., subject to cross-tenant sharing).
# A naked account_id on these is share-unsafe.
CLIENTS_RELATED = (
    'clients',       # the main table
    'uploads',       # join via client_id
    'enrichments',   # join via client_id
    'engagements',   # join via client_id
    'skills',        # join via client_id
    'document_analyses',
)

# Tables that are NOT clients-related — naked account_id is OK on these.
EXEMPT_TABLES = (
    'accounts',           # managing tenants themselves
    'system_config',      # HubSpot NULL-account namespace
    'users',              # user-by-account, not client-by-account
    'user_client_assignments',  # the helper itself uses this
    'client_shares',      # the share table
    'client_salesforce_links',
    'oauth_state_nonces',
    'salesforce_sync_log',
    'hubspot_sync_log',
)


def file_text(path: Path) -> list[str]:
    """Return file lines, stripping trailing newlines."""
    try:
        return path.read_text(encoding='utf-8').splitlines()
    except (UnicodeDecodeError, OSError):
        return []


def is_skipped(path: Path) -> bool:
    s = str(path)
    return any(p in s for p in SKIP_PATTERNS)


def context_window(lines: list[str], idx: int, before: int = 8, after: int = 4) -> str:
    """Return ~before+after lines around `idx` joined as one string for
    table detection. Tolerates multi-line SQL across triple-quoted strings."""
    lo = max(0, idx - before)
    hi = min(len(lines), idx + after + 1)
    return '\n'.join(lines[lo:hi])


def detect_table_context(context: str) -> str | None:
    """Inspect a few lines of SQL context and return the most relevant
    table reference: a CLIENTS_RELATED name (flag) or an EXEMPT_TABLES
    name (skip) or None (couldn't determine — flag conservatively).

    Uppercase-only keywords intentionally — SQL keywords in this codebase
    are written FROM/JOIN/UPDATE/INSERT INTO in caps. English "from admin"
    in a comment uses lowercase and won't match."""
    # Look for FROM <table>, JOIN <table>, UPDATE <table>, INSERT INTO <table>
    # All-uppercase keywords keep us out of English-text comments.
    for pattern in (
        r'\bFROM\s+(\w+)',
        r'\bJOIN\s+(\w+)',
        r'\bUPDATE\s+(\w+)',
        r'\bINSERT\s+INTO\s+(\w+)',
    ):
        for match in re.finditer(pattern, context):
            name = match.group(1).lower()
            if name in CLIENTS_RELATED:
                return name
            if name in EXEMPT_TABLES:
                # Keep looking — context may have BOTH clients and accounts.
                # If a clients-related table is also referenced, that wins.
                continue
    # Nothing decisive — fall back to whatever table name appeared.
    for pattern in (
        r'\bFROM\s+(\w+)',
        r'\bJOIN\s+(\w+)',
        r'\bUPDATE\s+(\w+)',
        r'\bINSERT\s+INTO\s+(\w+)',
    ):
        m = re.search(pattern, context)
        if m:
            name = m.group(1).lower()
            if name in EXEMPT_TABLES:
                return name  # confidently exempt
            return name  # any other name — caller flags conservatively
    return None


def audit_file(path: Path, verbose: bool = False) -> list[tuple[int, str, str]]:
    """Return list of (line_number, snippet, table_context) findings."""
    findings: list[tuple[int, str, str]] = []
    lines = file_text(path)
    for i, line in enumerate(lines):
        # Skip pure comment lines.
        stripped = line.lstrip()
        if stripped.startswith('#'):
            continue
        # Match the naked pattern.
        if not NAKED_ACCOUNT_ID.search(line):
            continue
        # Build context window to determine the table.
        ctx = context_window(lines, i, before=8, after=4)
        table = detect_table_context(ctx)
        if table in EXEMPT_TABLES:
            if verbose:
                print(f"  exempt: {path}:{i+1} (table={table})")
            continue
        # Flag.
        findings.append((i + 1, line.strip(), table or 'unknown'))
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verbose', '-v', action='store_true')
    args = parser.parse_args()

    files: list[Path] = []
    for pattern in AUDIT_GLOBS:
        files.extend(REPO_ROOT.glob(pattern))
    files = [p for p in files if not is_skipped(p)]
    files.sort()

    if args.verbose:
        print(f"Auditing {len(files)} files for naked WHERE account_id = %s "
              f"on clients-related tables...\n")

    total_findings: list[tuple[Path, int, str, str]] = []
    for f in files:
        for line_no, snippet, table in audit_file(f, verbose=args.verbose):
            rel = f.relative_to(REPO_ROOT)
            if (str(rel), line_no) in DEFERRED_LINES:
                if args.verbose:
                    print(f"  deferred: {rel}:{line_no}")
                continue
            total_findings.append((rel, line_no, snippet, table))

    if not total_findings:
        print("0 naked queries on clients-related tables.")
        return 0

    print(f"FAILED — {len(total_findings)} naked WHERE account_id = %s "
          f"finding(s) on clients-related tables:\n")
    for rel, line_no, snippet, table in total_findings:
        print(f"  {rel}:{line_no}  [table={table}]")
        print(f"    {snippet}")
    print()
    print("Each finding must either:")
    print("  (a) route through clients_where_fragment / can_user_access_client, or")
    print("  (b) be added to DEFERRED_LINES in this script with a ticket ref.")
    return 1


if __name__ == '__main__':
    sys.exit(main())
