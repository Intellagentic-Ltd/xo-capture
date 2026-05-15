"""
XO Platform - GET /rapid-prototype/:id Lambda
Generates a Claude Code-ready markdown build specification
from enrichment results + client metadata.
"""

import json
import os
import re
from datetime import datetime
import boto3


def slugify_problem(title):
    """Identical logic to frontend slugifyProblem — lowercase, strip non-alphanum, whitespace to hyphens, trim."""
    s = (title or '').lower()
    s = re.sub(r'[^a-z0-9\s-]', '', s)
    s = re.sub(r'\s+', '-', s)
    s = re.sub(r'-+', '-', s)
    s = s.strip('-')
    return s or 'unknown'
from auth_helper import require_auth, get_db_connection, CORS_HEADERS, log_activity
from client_access import clients_where_fragment
try:
    from crypto_helper import unwrap_client_key, decrypt_s3_body, maybe_decrypt_s3_body
except ImportError:
    def unwrap_client_key(x): return None
    def decrypt_s3_body(k, b): return b if isinstance(b, str) else b.decode('utf-8', errors='replace') if b else ''
    def maybe_decrypt_s3_body(k, b, enabled=True): return decrypt_s3_body(k, b)

s3_client = boto3.client('s3')
BUCKET_NAME = os.environ.get('BUCKET_NAME', 'xo-client-data-mv')


def lambda_handler(event, context):
    """
    Generate a rapid prototype spec for a client.

    Path parameter: client_id (s3_folder)

    Returns markdown file as attachment.
    """

    # Handle OPTIONS preflight
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    # Auth check
    user, err = require_auth(event)
    if err:
        log_activity(event, err)
        return err

    response = _handle_prototype(event, user)
    log_activity(event, response, user)
    return response


def _load_scope(cur, client_id, engagement_id):
    """Load POC scope: engagement-level first, client-level fallback."""
    if engagement_id:
        cur.execute("SELECT poc_scope FROM engagements WHERE id = %s", (engagement_id,))
        row = cur.fetchone()
        if row and row[0]:
            scope = row[0] if isinstance(row[0], dict) else json.loads(row[0]) if isinstance(row[0], str) else None
            if scope:
                return scope
    # Fallback to client-level
    cur.execute("SELECT poc_scope FROM clients WHERE s3_folder = %s", (client_id,))
    row = cur.fetchone()
    if row and row[0]:
        return row[0] if isinstance(row[0], dict) else json.loads(row[0]) if isinstance(row[0], str) else None
    return None


def _load_analysis(client_id, engagement_id, ck):
    """Load analysis JSON: engagement-scoped first, root fallback."""
    paths_tried = []
    if engagement_id:
        eng_key = f"{client_id}/engagements/{engagement_id}/results/analysis.json"
        paths_tried.append(eng_key)
        try:
            resp = s3_client.get_object(Bucket=BUCKET_NAME, Key=eng_key)
            raw = resp['Body'].read()
            return json.loads(maybe_decrypt_s3_body(ck, raw))
        except s3_client.exceptions.NoSuchKey:
            pass
    # Root fallback
    root_key = f"{client_id}/results/analysis.json"
    paths_tried.append(root_key)
    try:
        resp = s3_client.get_object(Bucket=BUCKET_NAME, Key=root_key)
        raw = resp['Body'].read()
        return json.loads(maybe_decrypt_s3_body(ck, raw))
    except s3_client.exceptions.NoSuchKey:
        raise FileNotFoundError(f"No analysis found at: {', '.join(paths_tried)}")


def _handle_prototype(event, user):
    try:
        path_params = event.get('pathParameters', {})
        client_id = path_params.get('id', '').strip()
        query_params = event.get('queryStringParameters') or {}
        engagement_id = query_params.get('engagement_id', '').strip() or None

        if not client_id:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'client_id is required'})
            }

        # Query client metadata from DB
        conn = get_db_connection()
        cur = conn.cursor()

        # PR 3.4b: share-aware access via shared/client_access fragment.
        frag, frag_params = clients_where_fragment(user, alias='c')
        cur.execute(f"""
            SELECT c.company_name, c.website_url, c.contact_name, c.contact_title,
                   c.industry, c.description, c.pain_point, c.encryption_key
            FROM clients c
            WHERE c.s3_folder = %s AND ({frag})
        """, (client_id,) + frag_params)

        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return {
                'statusCode': 404,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Client not found'})
            }

        ck = unwrap_client_key(row[7]) if row[7] else None
        poc_scope = _load_scope(cur, client_id, engagement_id)
        cur.close()
        conn.close()

        company_name = row[0] or 'Unknown Company'
        website_url = row[1] or ''
        contact_name = row[2] or ''
        contact_title = row[3] or ''
        industry = row[4] or ''
        description = row[5] or ''
        pain_point = row[6] or ''

        # Read analysis.json from S3 (engagement-scoped with root fallback)
        try:
            analysis = _load_analysis(client_id, engagement_id, ck)
        except FileNotFoundError:
            return {
                'statusCode': 404,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'No analysis results found. Run enrichment first.'})
            }

        # Build the markdown spec
        md = build_spec(
            client_id=client_id,
            company_name=company_name,
            website_url=website_url,
            contact_name=contact_name,
            contact_title=contact_title,
            industry=industry,
            description=description,
            pain_point=pain_point,
            analysis=analysis,
            poc_scope=poc_scope
        )

        # Return as markdown attachment
        response_headers = {
            **CORS_HEADERS,
            'Content-Type': 'text/markdown',
            'Content-Disposition': 'attachment; filename=PROTOTYPE-SPEC.md'
        }

        return {
            'statusCode': 200,
            'headers': response_headers,
            'body': md
        }

    except Exception as e:
        print(f"Error generating prototype spec: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }


def build_spec(client_id, company_name, website_url, contact_name,
               contact_title, industry, description, pain_point, analysis,
               poc_scope=None):
    """Build the full markdown prototype spec."""

    today = datetime.utcnow().strftime('%Y-%m-%d')
    problems = analysis.get('problems', [])
    schema = analysis.get('schema', {})
    tables = schema.get('tables', [])
    relationships = schema.get('relationships', [])
    plan = analysis.get('plan', [])
    sources = analysis.get('sources', [])

    # POC scope computation
    scope_active = poc_scope is not None
    scoped_problem_ids = set(poc_scope.get('problems', [])) if scope_active else None
    scoped_new_components = set(poc_scope.get('new_components', [])) if scope_active else None

    # Generate stable IDs for problems
    for p in problems:
        if not p.get('id'):
            p['id'] = slugify_problem(p.get('title', ''))

    # Stale scope detection: if scope is set but no problem IDs intersect, treat as stale
    current_problem_ids = set(p['id'] for p in problems)
    scope_stale = False
    if scope_active and scoped_problem_ids and not scoped_problem_ids.intersection(current_problem_ids):
        scope_stale = True
        # Fallback: treat all problems as in-scope
        scoped_problem_ids = current_problem_ids
        scoped_new_components = set(n.get('proposed_name', '') for n in analysis.get('component_mapping', {}).get('new_components', []))

    lines = []

    # Title
    lines.append(f"# {company_name} -- Rapid Prototype Spec")
    lines.append("")

    # Metadata
    lines.append(f"- **Capture ID:** {client_id}")
    lines.append(f"- **Generated:** {today}")
    if scope_active and scoped_problem_ids:
        scoped_titles = [p.get('title', '') for p in problems if p.get('id') in scoped_problem_ids]
        if scoped_titles:
            lines.append(f"- **Pain Point Target:** {', '.join(scoped_titles)}")
        else:
            # All scoped IDs were stale — fallback to all problem titles
            all_titles = [p.get('title', '') for p in problems]
            lines.append(f"- **Pain Point Target:** {', '.join(all_titles) or 'See analysis'}")
    else:
        primary_title = problems[0].get('title', '') if problems else ''
        lines.append(f"- **Pain Point Target:** {primary_title or 'See analysis'}")
    if scope_active:
        total_problems = len(problems)
        total_new = len(analysis.get('component_mapping', {}).get('new_components', []))
        lines.append(f"- **POC Scope:** {len(scoped_problem_ids)} of {total_problems} problems, {len(scoped_new_components)} of {total_new} components")
    lines.append("")

    # POC SCOPE (only if scope is set)
    if scope_active:
        in_scope_problems = [p for p in problems if p['id'] in scoped_problem_ids]
        out_scope_problems = [p for p in problems if p['id'] not in scoped_problem_ids]
        component_mapping = analysis.get('component_mapping', {})
        in_scope_comps = [n for n in component_mapping.get('new_components', []) if n.get('proposed_name') in scoped_new_components]
        out_scope_comps = [n for n in component_mapping.get('new_components', []) if n.get('proposed_name') not in scoped_new_components]

        lines.append("## POC SCOPE")
        lines.append("")
        if scope_stale:
            lines.append("**Warning:** Scope was set against a previous enrichment. Re-open the Scope POC modal to refresh.")
            lines.append("")
        lines.append("**In scope (build in 21 days):**")
        for p in in_scope_problems:
            lines.append(f"- {p.get('title', '')}")
        for c in in_scope_comps:
            lines.append(f"- New component: {c.get('proposed_name', '')}")
        lines.append("")
        if out_scope_problems or out_scope_comps:
            lines.append("**Phase 2 candidates (scaffold data model only, no features/UI):**")
            for p in out_scope_problems:
                lines.append(f"- {p.get('title', '')}")
            for c in out_scope_comps:
                lines.append(f"- New component: {c.get('proposed_name', '')}")
            lines.append("")
        lines.append("**Instruction to build agent:** Build every item tagged [POC] fully -- features, UI, seed data. For [PHASE 2] items, create the data model tables and relationships so the POC is forward-compatible, but skip features, UI screens, API endpoints, and seed data for Phase 2-only entities.")
        lines.append("")
        if poc_scope.get('scoped_by'):
            scoped_date = ''
            if poc_scope.get('scoped_at'):
                try:
                    from datetime import datetime as dt
                    scoped_date = dt.fromisoformat(poc_scope['scoped_at'].replace('Z', '+00:00')).strftime('%d %b %Y')
                except: scoped_date = poc_scope['scoped_at'][:10]
            lines.append(f"Scoped by {poc_scope['scoped_by']} on {scoped_date}.")
            lines.append("")

    # WHAT THIS IS
    lines.append("## WHAT THIS IS")
    lines.append("")
    lines.append(f"A rapid prototype that demonstrates how IntellagenticXO addresses {company_name}'s priority operational pain points.")
    lines.append("")

    # THE CLIENT
    lines.append("## THE CLIENT")
    lines.append("")
    lines.append(f"- **Company:** {company_name}")
    if industry:
        lines.append(f"- **Industry:** {industry}")
    if description:
        lines.append(f"- **Description:** {description}")
    if contact_name:
        lines.append(f"- **Contact:** {contact_name}")
    if contact_title:
        lines.append(f"- **Title:** {contact_title}")
    if website_url:
        lines.append(f"- **Website:** {website_url}")
    lines.append("")

    # THE PROBLEM
    lines.append("## THE PROBLEM")
    lines.append("")
    summary_text = analysis.get('summary', '')
    if not summary_text and problems:
        summary_text = problems[0].get('evidence', '')
    if summary_text:
        lines.append(f"**Overview:** {summary_text}")
        lines.append("")

    if problems:
        # Sort by severity -- critical first
        severity_order = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3}
        sorted_problems = sorted(
            problems,
            key=lambda p: severity_order.get(p.get('severity', 'low'), 4)
        )

        primary = sorted_problems[0]
        lines.append(f"**Primary Problem ({primary.get('severity', 'high').upper()}):** {primary.get('title', '')}")
        lines.append("")
        if primary.get('evidence'):
            lines.append(f"**Evidence:** {primary['evidence']}")
            lines.append("")
        if primary.get('recommendation'):
            lines.append(f"**Recommendation:** {primary['recommendation']}")
            lines.append("")

        if len(sorted_problems) > 1:
            lines.append("**Additional Context:**")
            for p in sorted_problems[1:]:
                sev = p.get('severity', '').upper()
                title = p.get('title', '')
                lines.append(f"- [{sev}] {title}")
            lines.append("")

    # PROPOSED ARCHITECTURE
    arch_diagram = analysis.get('architecture_diagram', '')
    component_mapping = analysis.get('component_mapping', {})
    if arch_diagram:
        lines.append("## PROPOSED ARCHITECTURE")
        lines.append("")
        # POC scope legend
        if scope_active and component_mapping:
            poc_items = []
            phase2_items = []
            for f in component_mapping.get('fits', []):
                poc_items.append(f"{f.get('component', '')} [EXISTING]")
            for e in component_mapping.get('extends', []):
                poc_items.append(f"{e.get('component', '')} [EXTEND]")
            for n in component_mapping.get('new_components', []):
                name = n.get('proposed_name', '')
                if name in scoped_new_components:
                    poc_items.append(f"{name} [NEW]")
                else:
                    phase2_items.append(f"{name} [NEW]")
            lines.append(f"**POC scope:** {', '.join(poc_items)}")
            if phase2_items:
                lines.append(f"**Phase 2:** {', '.join(phase2_items)}")
            lines.append("")
            lines.append("(See POC SCOPE section above for rationale. Boxes in the diagram below are drawn for the full target architecture.)")
            lines.append("")
        lines.append("```")
        lines.append(arch_diagram)
        lines.append("```")
        lines.append("")
        # Programmatic caption (always, regardless of scope)
        summary_line = component_mapping.get('summary_line', '')
        if summary_line:
            lines.append(f"**{summary_line}**")
            lines.append("")

    # COMPONENT REUSE MAP
    if component_mapping and (component_mapping.get('fits') or component_mapping.get('extends') or component_mapping.get('new_components')):
        lines.append("## COMPONENT REUSE MAP")
        lines.append("")
        lines.append("Before building anything new, check what IntellagenticXO already has.")
        lines.append("")
        for fit in component_mapping.get('fits', []):
            tag = ' [POC]' if scope_active else ''
            lines.append(f"### EXISTING -- {fit.get('component', '')} {fit.get('version', '')}{tag}")
            lines.append(f"- Capability: {fit.get('capability', '')}")
            lines.append(f"- Action: deploy existing component with config")
            if fit.get('config_notes'):
                lines.append(f"- Config notes: {fit['config_notes']}")
            lines.append("")
        for ext in component_mapping.get('extends', []):
            tag = ' [POC]' if scope_active else ''
            lines.append(f"### EXTEND -- {ext.get('component', '')} {ext.get('from_version', '')} -> {ext.get('to_version', '')}{tag}")
            lines.append(f"- Capability added: {ext.get('capability', '')}")
            if ext.get('extension_notes'):
                lines.append(f"- Extension notes: {ext['extension_notes']}")
            lines.append("")
        for new_comp in component_mapping.get('new_components', []):
            name = new_comp.get('proposed_name', '')
            tag = ''
            if scope_active:
                tag = ' [POC]' if name in scoped_new_components else ' [PHASE 2]'
            lines.append(f"### NEW COMPONENT NEEDED -- {name}{tag}")
            lines.append(f"- Purpose: {new_comp.get('purpose', '')}")
            if new_comp.get('justification'):
                lines.append(f"- Justification: {new_comp['justification']}")
            lines.append(f"- Action: scaffold in 01_Components/{name}/; this deployment funds its v1 build")
            lines.append("")

    # WHAT TO BUILD
    lines.append("## WHAT TO BUILD")
    lines.append("")

    day7_actions = []
    day14_actions = []
    day21_actions = []

    for item in plan:
        phase = item.get('phase', '')
        actions = item.get('actions', [])
        if '7' in phase:
            day7_actions = actions
        elif '14' in phase:
            day14_actions = actions
        elif '21' in phase:
            day21_actions = actions

    if day7_actions:
        lines.append("### Core Features (Week 1 -- Build These)")
        lines.append("")
        for i, action in enumerate(day7_actions, 1):
            raw = action.split('. ', 1)[-1] if '. ' in action else action
            tag_match = re.match(r'^\[[^\]]+\]', raw)
            tag = tag_match.group(0) + ' ' if tag_match else ''
            stripped = re.sub(r'^\[[^\]]+\]\s*', '', raw).strip()
            title = stripped[:60].rsplit(' ', 1)[0] + '...' if len(stripped) > 60 else stripped
            # POC/PHASE 2 tag based on component reference
            scope_tag = ''
            if scope_active and tag_match:
                tag_content = tag_match.group(0)[1:-1]  # strip [ ]
                # Check if any referenced component is Phase 2
                comp_names = [c.strip() for c in tag_content.replace('XO +', '').replace('XO', '').replace('Streamline', '').split('+')]
                comp_names = [c for c in comp_names if c]
                is_phase2 = any(c in (scoped_new_components ^ scoped_new_components) for c in []) if False else False
                # EXISTING/EXTEND always POC; NEW only POC if in scoped_new_components
                all_new = [n.get('proposed_name', '') for n in component_mapping.get('new_components', [])]
                phase2_comps = set(all_new) - scoped_new_components
                if any(c in phase2_comps for c in comp_names):
                    scope_tag = '[PHASE 2] '
                else:
                    scope_tag = '[POC] '
            elif scope_active:
                scope_tag = '[POC] '
            lines.append(f"**Feature {i}: {scope_tag}{tag}{title}**")
            lines.append("")
            if len(stripped) > 60:
                lines.append(f"_{stripped}_")
                lines.append("")
            lines.append(f"- Screen: dashboard/view for this feature")
            lines.append(f"- Components: Data table, filters, action buttons")
            lines.append(f"- API: CRUD endpoints")
            lines.append("")

    if day14_actions or day21_actions:
        lines.append("### Weeks 2-3 (Validate & Decide)")
        lines.append("")
        for action in day14_actions:
            lines.append(f"- [Week 2] {action}")
        for action in day21_actions:
            lines.append(f"- [Week 3] {action}")
        lines.append("")

    # DATABASE SCHEMA
    lines.append("## DATABASE SCHEMA")
    lines.append("")

    if tables:
        for table in tables:
            table_name = table.get('name', 'unknown')
            lines.append(f"### {table_name}")
            lines.append("")
            lines.append("| Column | Type | Description |")
            lines.append("|--------|------|-------------|")
            for col in table.get('columns', []):
                col_name = col.get('name', '')
                col_type = col.get('type', '')
                col_desc = col.get('description', '')
                lines.append(f"| {col_name} | {col_type} | {col_desc} |")
            lines.append("")

        if relationships:
            lines.append("### Relationships")
            lines.append("")
            for rel in relationships:
                lines.append(f"- {rel}")
            lines.append("")
    else:
        lines.append("No schema tables defined. Build schema based on the problems and features above.")
        lines.append("")

    # SEED DATA
    lines.append("## SEED DATA")
    lines.append("")
    lines.append("Generate synthetic seed data for all tables above. Base it on these data sources:")
    lines.append("")
    if sources:
        seen = set()
        for source in sources:
            src_type = source.get('type', 'unknown')
            src_ref = source.get('reference', source.get('name', source.get('filename', 'unknown')))
            key = f"{src_type}:{src_ref}"
            if key not in seen:
                seen.add(key)
                lines.append(f"- [{src_type}] {src_ref}")
    else:
        lines.append("- No specific sources identified. Use industry-appropriate sample data.")
    lines.append("")
    lines.append("Create at least 20 realistic records per table. Use industry-appropriate terminology.")
    lines.append("")

    # TECH STACK
    lines.append("## TECH STACK")
    lines.append("")
    lines.append("- **Frontend:** React 18 + Vite 5 (single-page app)")
    lines.append("- **Backend:** Python (Flask for local dev, AWS Lambda for production)")
    lines.append("- **Database:** PostgreSQL 15")
    lines.append("- **Styling:** CSS custom properties, dark/light theme support")
    lines.append("- **Icons:** Lucide React")
    lines.append("")

    # UI LAYOUT
    lines.append("## UI LAYOUT")
    lines.append("")
    lines.append("### Dashboard Screen")
    lines.append("")
    lines.append("- Top row: 4 stat cards (key metrics from seed data)")
    lines.append("- Main area: Data table with sortable columns, search, filters")
    lines.append("- Sidebar: Quick actions, recent activity")
    lines.append("")

    if day7_actions:
        for i, action in enumerate(day7_actions, 1):
            raw = action.split('. ', 1)[-1] if '. ' in action else action
            stripped = re.sub(r'^\[[^\]]+\]\s*', '', raw).strip()
            title = stripped[:60].rsplit(' ', 1)[0] + '...' if len(stripped) > 60 else stripped
            lines.append(f"### {title}")
            lines.append("")
            lines.append(f"- List view with filterable table")
            lines.append(f"- Detail view with edit form")
            lines.append(f"- Create/edit modal")
            lines.append("")

    # API ENDPOINTS
    lines.append("## API ENDPOINTS")
    lines.append("")

    if tables:
        for table in tables:
            table_name = table.get('name', 'unknown')
            lines.append(f"### {table_name}")
            lines.append("")
            lines.append(f"- `GET /api/{table_name}` -- List all (with pagination, filters)")
            lines.append(f"- `GET /api/{table_name}/:id` -- Get one by ID")
            lines.append(f"- `POST /api/{table_name}` -- Create new")
            lines.append(f"- `PUT /api/{table_name}/:id` -- Update existing")
            lines.append(f"- `DELETE /api/{table_name}/:id` -- Delete")
            lines.append("")

    lines.append("### Custom Endpoints")
    lines.append("")
    lines.append("- `GET /api/dashboard/stats` -- Aggregate metrics for dashboard cards")
    lines.append("- `GET /api/search?q=` -- Global search across all entities")
    lines.append("")

    # BUILD SEQUENCE
    lines.append("## BUILD SEQUENCE")
    lines.append("")
    lines.append("### Phase 1: Database")
    lines.append("- [ ] Create PostgreSQL database and tables")
    lines.append("- [ ] Run seed data script")
    lines.append("- [ ] Verify all relationships and constraints")
    lines.append("")
    lines.append("### Phase 2: API")
    lines.append("- [ ] Set up Flask app with CORS")
    lines.append("- [ ] Implement CRUD endpoints for each table")
    lines.append("- [ ] Add dashboard stats endpoint")
    lines.append("- [ ] Test all endpoints with seed data")
    lines.append("")
    lines.append("### Phase 3: Frontend")
    lines.append("- [ ] Scaffold React + Vite project")
    lines.append("- [ ] Build dashboard with stat cards and data table")
    lines.append("- [ ] Build detail/edit screens for each entity")
    lines.append("- [ ] Connect to API, add loading states and error handling")
    lines.append("")
    lines.append("### Phase 4: Verify")
    lines.append("- [ ] End-to-end walkthrough of all screens")
    lines.append("- [ ] Verify CRUD operations work correctly")
    lines.append("- [ ] Check responsive layout")
    lines.append("- [ ] Prepare 4-minute demo script")
    lines.append("")

    # BOTTOM LINE
    lines.append("## BOTTOM LINE")
    lines.append("")
    if contact_name:
        lines.append(f"This prototype demonstrates to {contact_name} that {company_name}'s operational priorities can be addressed with software -- fast, specific, and measurable.")
    else:
        lines.append(f"This prototype demonstrates that {company_name}'s operational priorities can be addressed with software -- fast, specific, and measurable.")
    lines.append("")
    lines.append("The demo walkthrough should take 4 minutes:")
    lines.append("1. Show the dashboard with real-looking data")
    lines.append("2. Click into a detail record, edit a field, save")
    lines.append("3. Create a new record from scratch")
    lines.append("4. Show how the dashboard stats update")
    lines.append("")

    # Footer
    lines.append("---")
    lines.append(f"Intellagentic | XO Capture | {client_id}")
    lines.append("")

    return '\n'.join(lines)
