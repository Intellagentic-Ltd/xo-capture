"""
XO Platform - Results Lambda
GET /results/:id — Returns analysis results for a client
"""

import json
import os
import re
import boto3
from auth_helper import require_auth, get_db_connection, CORS_HEADERS, log_activity
from client_access import clients_where_fragment
try:
    from crypto_helper import unwrap_client_key, decrypt_s3_body, client_decrypt, client_decrypt_json, maybe_decrypt_s3_body
except ImportError:
    def unwrap_client_key(x): return None
    def decrypt_s3_body(k, b): return b if isinstance(b, str) else b.decode('utf-8', errors='replace') if b else ''
    def maybe_decrypt_s3_body(k, b, enabled=True): return decrypt_s3_body(k, b)
    def client_decrypt(k, x): return x
    def client_decrypt_json(k, x):
        if not x: return None
        try: return json.loads(x)
        except: return None

s3_client = boto3.client('s3')
BUCKET_NAME = os.environ.get('BUCKET_NAME', 'xo-client-data-mv')


def _get_enrichment_results(client_id, user, engagement_id=None):
    """Fetch latest enrichment results for a client (optionally scoped to an engagement). Returns (results_dict, error_response)."""
    conn = get_db_connection()
    cur = conn.cursor()

    # Build engagement filter
    eng_filter = ""
    eng_params = []
    if engagement_id:
        eng_filter = " AND e.engagement_id = %s"
        eng_params = [engagement_id]

    # PR 3.4b: shared/client_access drives the role-based filter, including
    # the cross-tenant share path for account_admin recipients.
    access_frag, access_params = clients_where_fragment(user, alias='c')
    cur.execute(f"""
        SELECT e.status, e.results_s3_key, e.stage, c.encryption_key, e.error_message
        FROM enrichments e JOIN clients c ON e.client_id = c.id
        WHERE c.s3_folder = %s AND ({access_frag}){eng_filter}
        ORDER BY e.started_at DESC LIMIT 1
    """, (client_id, *access_params, *eng_params))

    row = cur.fetchone()
    cur.close()
    conn.close()

    ck = unwrap_client_key(row[3]) if row and row[3] else None

    if row:
        enrichment_status = row[0]
        results_s3_key = row[1]
        enrichment_stage = row[2]
        enrichment_error = row[4] if len(row) > 4 else None

        if enrichment_status == 'processing':
            return None, {
                'statusCode': 200,
                'headers': CORS_HEADERS,
                'body': json.dumps({
                    'status': 'processing',
                    'stage': enrichment_stage or 'extracting',
                    'message': 'Analysis in progress'
                })
            }

        # `failed` is the new halt status (Stage 1 retry exhaustion etc.)
        # `error` is the legacy status from the prior generation of code.
        # Treat both identically for the API; surface error_message when set.
        if enrichment_status in ('failed', 'error'):
            return None, {
                'statusCode': 200,
                'headers': CORS_HEADERS,
                'body': json.dumps({
                    'status': 'failed',
                    'stage': enrichment_stage or '',
                    'message': enrichment_error or 'Enrichment failed',
                })
            }

        if engagement_id:
            s3_key = results_s3_key or f"{client_id}/engagements/{engagement_id}/results/analysis.json"
        else:
            s3_key = results_s3_key or f"{client_id}/results/analysis.json"
    else:
        if engagement_id:
            s3_key = f"{client_id}/engagements/{engagement_id}/results/analysis.json"
        else:
            s3_key = f"{client_id}/results/analysis.json"

    try:
        s3_response = s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
        raw = s3_response['Body'].read()
        decrypted = maybe_decrypt_s3_body(ck, raw)
        results = json.loads(decrypted)
        results['status'] = 'complete'
        return results, None
    except s3_client.exceptions.NoSuchKey:
        # Fallback: if engagement-scoped path missing, try root path
        if engagement_id:
            root_key = f"{client_id}/results/analysis.json"
            try:
                s3_response = s3_client.get_object(Bucket=BUCKET_NAME, Key=root_key)
                raw = s3_response['Body'].read()
                decrypted = maybe_decrypt_s3_body(ck, raw)
                results = json.loads(decrypted)
                results['status'] = 'complete'
                return results, None
            except s3_client.exceptions.NoSuchKey:
                pass
        return None, {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'status': 'processing', 'message': 'Analysis in progress'})
        }


def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    user, err = require_auth(event)
    if err:
        log_activity(event, err)
        return err

    response = _handle_results(event, user)

    log_activity(event, response, user)
    return response


def _handle_results(event, user):
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

        results, error_resp = _get_enrichment_results(client_id, user, engagement_id=engagement_id)
        if error_resp:
            return error_resp

        # Inject client metadata from database
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            cur.execute("""
                SELECT company_name, industry, description, contact_name, contact_email,
                       encryption_key, contacts_json, approved_at
                FROM clients WHERE s3_folder = %s
            """, (client_id,))
            crow = cur.fetchone()
            cur.close()
            conn.close()
            if crow:
                results['company_name'] = crow[0] or ''
                results['client_industry'] = crow[1] or ''
                results['client_description'] = crow[2] or ''
                results['client_contact'] = crow[3] or ''
                results['client_email'] = crow[4] or ''
                # Parse contacts_json for primary contact
                contacts = None
                if crow[6]:
                    try:
                        contacts = json.loads(crow[6]) if isinstance(crow[6], str) else crow[6]
                    except (json.JSONDecodeError, TypeError):
                        contacts = None
                if contacts and isinstance(contacts, list) and len(contacts) > 0:
                    primary = contacts[0]
                    fn = primary.get('firstName', '')
                    ln = primary.get('lastName', '')
                    if fn or ln:
                        results['client_contact'] = f"{fn} {ln}".strip()
                    if primary.get('email') and not results.get('client_email'):
                        results['client_email'] = primary['email']
                    if primary.get('title'):
                        results['client_contact_title'] = primary['title']
                # Use engagement-level approved_at when scoped, else client-level
                if engagement_id:
                    try:
                        conn2 = get_db_connection()
                        cur2 = conn2.cursor()
                        cur2.execute("SELECT approved_at, name FROM engagements WHERE id = %s", (engagement_id,))
                        erow = cur2.fetchone()
                        cur2.close()
                        conn2.close()
                        results['approved_at'] = erow[0].isoformat() if erow and erow[0] else None
                        results['engagement_name'] = erow[1] if erow else ''
                    except Exception as e2:
                        print(f"Failed to fetch engagement approved_at: {e2}")
                        results['approved_at'] = None
                else:
                    results['approved_at'] = crow[7].isoformat() if crow[7] else None
        except Exception as e:
            print(f"Failed to inject client metadata (non-fatal): {e}")

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps(results)
        }

    except Exception as e:
        print(f"Error retrieving results: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Internal server error', 'message': str(e)})
        }


# ── Deployment Brief Assembly ──

def _strip_leading_number(text):
    """Remove leading '1. ', '2. ' etc from action text."""
    return re.sub(r'^\d+\.\s*', '', text)


def _assemble_brief(results, client_name='', industry='', description='', contact_name=''):
    """Assemble deployment brief from existing analysis results — no Bedrock call."""
    problems = results.get('problems', results.get('problems_identified', []))
    primary = problems[0] if problems else {}
    plan = results.get('plan', results.get('action_plan', {}))
    plan_phases = []
    if isinstance(plan, list):
        plan_phases = plan
    elif isinstance(plan, dict):
        plan_phases = [{'phase': k, 'actions': v} for k, v in plan.items()]

    company = client_name or results.get('company_name', 'the client')
    ind = industry or 'this domain'

    return {
        'cover': {
            'client_name': company,
            'client_descriptor': description or ind,
            'headline': f"XO Deployment: {primary.get('title', 'Operational Transformation')}" if primary else f"XO Deployment for {company}",
            'value_proposition': (results.get('bottom_line', '') or '').split('.')[0] + '.' if results.get('bottom_line') else '',
            'client_contact': contact_name,
            'meeting_date': 'TBD',
        },
        'executive_summary': results.get('summary', results.get('executive_summary', '')),
        'key_metrics': [
            {'value': str(len(problems)), 'label': 'Critical Issues Identified',
             'sublabel': f"{sum(1 for p in problems if p.get('severity') == 'high')} high severity"},
        ] + [{'value': p.get('severity', 'N/A').upper(), 'label': p.get('title', '')[:40], 'sublabel': f"{p.get('severity', '')} priority"} for p in problems[:2]],
        'sections': [
            {'number': '01', 'title': f'CLIENT PROFILE: {company}',
             'content': (results.get('summary', '') or '') + (f"\n\n**Industry:** {ind}\n\n{description}" if description else ''),
             'callout': {'label': f'THE {ind.upper()} CONTEXT', 'content': primary.get('evidence', '')}},
            {'number': '02', 'title': 'THE OPERATIONAL CRISIS',
             'content': '\n\n---\n\n'.join(
                 f"**{p.get('title', '')}** ({p.get('severity', '')} severity)\n{p.get('evidence', '')}\n\n**Recommendation:** {p.get('recommendation', '')}"
                 for p in problems)},
            {'number': '03', 'title': 'WHY STANDARD AI CANNOT BE USED HERE',
             'content': f"Generic AI tools like ChatGPT or off-the-shelf automation platforms cannot safely operate in {ind} because they lack domain-specific guardrails. In {company}'s environment, a single error in {primary.get('title', 'operational processes').lower() if primary else 'operational processes'} could result in {primary.get('evidence', 'significant compliance and operational failures').split('.')[0].lower() if primary else 'significant compliance and operational failures'}.\n\nStandard AI has no concept of {ind} compliance hierarchies, cannot cross-reference domain-specific standards and regulations, and provides no audit trail for regulatory accountability. The XO platform's Constitutional Safety layer ensures that every AI-generated output is bounded by domain rules that the operator defines and controls."},
            {'number': '04', 'title': 'THE XO DEPLOYMENT: ARCHITECTURE & OODA WORKFLOW',
             'content': (f"```\n{results.get('architecture_diagram', '')}\n```\n\n" if results.get('architecture_diagram') else '') +
                f"The XO deployment for {company} operates on a continuous **Observe-Orient-Decide-Act** loop, processing {ind} data through domain-specific rules before any output reaches the operator.\n\n"
                f"**Observe:** XO ingests documents, data feeds, and operational inputs from {company}'s systems.\n"
                f"**Orient:** The DX Cartridge contextualises each input against {ind} rules, standards, and historical patterns.\n"
                f"**Decide:** XO generates recommendations bounded by Constitutional Safety rules — flagging items that require human judgment.\n"
                f"**Act:** Approved outputs are delivered through Streamline workflows, with full audit logging."},
            {'number': '05', 'title': 'CONSTITUTIONAL SAFETY',
             'content': f"XO enforces a Constitutional Layer — a set of immutable domain rules that the AI cannot override. For {company}, this means:\n\n"
                f"- **Compliance Validation:** Every output is validated against {ind} standards and regulations before delivery\n"
                f"- **Human Authority:** The operator retains final authority on all decisions flagged as requiring human judgment\n"
                f"- **Audit Trail:** All AI actions are logged with full provenance for regulatory audit\n"
                f"- **Domain Boundaries:** Boundaries are encoded as rules, not suggestions — the system cannot generate outputs that violate them"},
            {'number': '06', 'title': 'INTELLISTACK STREAMLINE APPLICATIONS',
             'content': results.get('streamline_applications', '')},
            {'number': '07', 'title': 'PROOF OF CONCEPT & NEXT STEPS',
             'content': '\n\n'.join(f"**{p.get('phase', '')}**\n" + '\n'.join(f"{i+1}. {_strip_leading_number(a)}" for i, a in enumerate(p.get('actions', []) if isinstance(p.get('actions'), list) else []))
                                    for p in plan_phases)},
        ],
        'ooda_phases': [
            {'name': 'OBSERVE', 'tagline': f"Ingests {company}'s operational data", 'bullets': ['Document upload and extraction', 'Data feed integration', 'Historical pattern capture']},
            {'name': 'ORIENT', 'tagline': f'Contextualises against {ind} rules', 'bullets': ['Domain rule matching', 'Compliance cross-reference', 'Risk classification']},
            {'name': 'DECIDE', 'tagline': 'Generates bounded recommendations', 'bullets': ['AI analysis within safety constraints', 'Human-judgment flagging', 'Confidence scoring']},
            {'name': 'ACT', 'tagline': 'Delivers through Streamline workflows', 'bullets': ['Automated report generation', 'Notification and escalation', 'Full audit logging']},
        ],
        'poc_timeline': [
            {'step': '1', 'timeline': 'Week 1', 'action': _strip_leading_number(plan_phases[0].get('actions', ['Configure DX Cartridge'])[0] if plan_phases else 'Configure DX Cartridge with domain rules')},
            {'step': '2', 'timeline': 'Week 1-2', 'action': _strip_leading_number(plan_phases[0].get('actions', ['', 'Ingest sample data'])[1] if plan_phases and len(plan_phases[0].get('actions', [])) > 1 else 'Ingest sample data and validate extraction')},
            {'step': '3', 'timeline': 'Week 2', 'action': _strip_leading_number(plan_phases[1].get('actions', ['Run analysis'])[0] if len(plan_phases) > 1 else 'Run analysis against live data')},
            {'step': '4', 'timeline': 'Week 3', 'action': _strip_leading_number(plan_phases[2].get('actions', ['Deploy decision'])[0] if len(plan_phases) > 2 else 'Review results and make deploy/iterate decision')},
        ],
        'success_metric': f"The pilot is successful when {primary.get('title', 'the primary operational bottleneck').lower()} is resolved without manual intervention in the current workflow." if primary else 'The pilot is successful when the primary operational bottleneck is resolved through automated XO processing.',
    }

