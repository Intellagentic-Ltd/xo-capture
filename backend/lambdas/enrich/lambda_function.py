"""
XO Platform - POST /enrich Lambda
Analyzes uploaded documents using Claude API.
Reads metadata from PostgreSQL, tracks enrichment in DB.

Two-phase async pattern:
  Phase 1 (synchronous): Auth, validate, create enrichment record, self-invoke async
  Phase 2 (async): Extract text, transcribe audio, analyze with Claude, write results
"""

import json
import os
import time
import re
import uuid
import urllib.parse
import urllib.request
import urllib.error
import boto3
import io
import csv
from datetime import datetime, timezone
from auth_helper import require_auth, get_db_connection, CORS_HEADERS, log_activity
from client_access import clients_where_fragment
from preprocess_per_document import (
    STAGE1_PROMPT_VERSION,
    Stage1FailedError,
    run_stage1_parallel,
    build_stage2_input,
)
try:
    from crypto_helper import (
        decrypt, decrypt_json, unwrap_client_key,
        client_decrypt, client_decrypt_json,
        decrypt_s3_body, decrypt_s3_bytes, encrypt_s3_body,
        maybe_encrypt_s3_body, maybe_decrypt_s3_body, maybe_decrypt_s3_bytes,
        is_s3_encryption_enabled
    )
except ImportError:
    import json as _json
    def decrypt(x): return x
    def decrypt_json(x):
        if not x: return None
        try: return _json.loads(x)
        except: return None
    def unwrap_client_key(x): return None
    def client_decrypt(k, x): return x
    def client_decrypt_json(k, x):
        if not x: return None
        try: return _json.loads(x)
        except: return None
    def decrypt_s3_body(k, b): return b if isinstance(b, str) else b.decode('utf-8', errors='replace') if b else ''
    def decrypt_s3_bytes(k, d): return d
    def encrypt_s3_body(k, b): return b if isinstance(b, bytes) else (b.encode('utf-8') if b else b'')

s3_client = boto3.client('s3')
lambda_client = boto3.client('lambda')
transcribe_client = boto3.client('transcribe')

BUCKET_NAME = os.environ.get('BUCKET_NAME', 'xo-client-data-mv')
BEDROCK_REGION = os.environ.get('BEDROCK_REGION', 'us-west-2')
AWS_BEARER_TOKEN_BEDROCK = os.environ.get('AWS_BEARER_TOKEN_BEDROCK', '')
FUNCTION_NAME = os.environ.get('AWS_LAMBDA_FUNCTION_NAME', 'xo-enrich')
STREAMLINE_WEBHOOK_URL = os.environ.get('STREAMLINE_WEBHOOK_URL', '')
AUDIO_EXTENSIONS = {'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma', 'mp4', 'webm'}
SYSTEM_SKILLS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'system-skills')

# Bedrock client for IAM role fallback (only used when no bearer token)
bedrock_client = None if AWS_BEARER_TOKEN_BEDROCK else boto3.client('bedrock-runtime', region_name=BEDROCK_REGION)
if AWS_BEARER_TOKEN_BEDROCK:
    print(f"Bedrock auth: using bearer token (region={BEDROCK_REGION})")
else:
    print(f"Bedrock auth: using Lambda IAM role (region={BEDROCK_REGION})")

# Map Anthropic model names to Bedrock model IDs
BEDROCK_MODEL_MAP = {
    'claude-opus-4-7': 'eu.anthropic.claude-opus-4-7',
    'claude-opus-4-6': 'eu.anthropic.claude-opus-4-6-v1',
    'claude-sonnet-4-6': 'eu.anthropic.claude-sonnet-4-6-v1',
    'claude-sonnet-4-5-20250929': 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
    'claude-haiku-4-5-20251001': 'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
}


def _invoke_bedrock_bearer(model_id, body_str):
    """Call Bedrock Converse API using bearer token auth."""
    encoded_model = urllib.parse.quote(model_id, safe='')
    url = f"https://bedrock-runtime.{BEDROCK_REGION}.amazonaws.com/model/{encoded_model}/converse"

    req = urllib.request.Request(
        url,
        data=body_str.encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': f'Bearer {AWS_BEARER_TOKEN_BEDROCK}'
        },
        method='POST'
    )

    try:
        with urllib.request.urlopen(req, timeout=840) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8', errors='replace')
        print(f"Bedrock Converse API error: HTTP {e.code} - {error_body}")
        raise Exception(f"Bedrock API error {e.code}: {error_body}")


def _get_system_config_value(conn, key):
    """Read a single value from system_config table. Opens own connection if conn is None."""
    own_conn = False
    try:
        if conn is None:
            conn = get_db_connection()
            own_conn = True
        cur = conn.cursor()
        cur.execute("SELECT config_value FROM system_config WHERE config_key = %s", (key,))
        row = cur.fetchone()
        cur.close()
        if own_conn:
            conn.close()
        return row[0] if row else ''
    except Exception as e:
        print(f"Failed to read system_config key '{key}' (non-fatal): {e}")
        if own_conn and conn:
            try:
                conn.close()
            except Exception:
                pass
        return ''


def lambda_handler(event, context):
    """
    Two-phase enrichment handler.

    Phase 1 (API Gateway request): Auth, validate, create record, self-invoke async.
    Phase 2 (async invocation): Run full enrichment pipeline.
    """

    # Phase 2: async pipeline execution
    if event.get('_async_phase'):
        return _run_enrichment_pipeline(event)

    # Phase 1: synchronous API Gateway handler

    # Handle OPTIONS preflight
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    # Route: POST /send-to-streamline
    resource = event.get('resource', '')
    if resource == '/send-to-streamline':
        response = _handle_send_to_streamline(event)
        log_activity(event, response)
        return response

    # Auth check
    user, err = require_auth(event)
    if err:
        log_activity(event, err)
        return err

    response = _handle_enrich_request(event, user)
    log_activity(event, response, user)
    return response


def _handle_enrich_request(event, user):
    conn = None

    try:
        body = json.loads(event.get('body', '{}'))
        client_id = body.get('client_id', '').strip()
        requested_model = body.get('model', '')
        engagement_id = body.get('engagement_id', '').strip() or None

        if not client_id:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'client_id is required'})
            }

        # Read client metadata from DB
        conn = get_db_connection()
        cur = conn.cursor()

        # Also read user's preferred_model as fallback. Default is Opus 4.6 —
        # the tier-1 model — to avoid silent downgrades when preferred_model is
        # NULL or the user row is missing.
        cur.execute(
            "SELECT COALESCE(preferred_model, 'claude-opus-4-6') FROM users WHERE id = %s",
            (user['user_id'],)
        )
        user_row = cur.fetchone()
        db_model = user_row[0] if user_row else 'claude-opus-4-6'

        # Priority: request body > user preference > default
        allowed_models = ['claude-opus-4-6', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001']
        model_to_use = requested_model if requested_model in allowed_models else db_model
        print(f"Using model: {model_to_use}")

        # PR 3.4b: share-aware access via shared/client_access fragment.
        # Account_admin recipient with a read_write share on this client
        # can trigger enrichment — same as owner.
        frag, frag_params = clients_where_fragment(user, alias='c')
        cur.execute(f"""
            SELECT c.company_name, c.website_url, c.contact_name, c.contact_title,
                   c.contact_linkedin, c.industry, c.description, c.pain_point, c.id, c.user_id
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
                'body': json.dumps({'error': 'Client not found or not accessible'})
            }

        if user.get('is_admin') and str(row[9]) != user['user_id']:
            print(f"Admin bypass: user {user.get('email')} enriching client {client_id} owned by {row[9]}")

        db_client_id = str(row[8])

        # Query active upload S3 keys + ids (only process active sources).
        # The upload_id is needed by Stage 1 caching downstream.
        # Predicate is `status = 'active'` only — the column is now NOT NULL
        # with default 'active' (see schema.sql), and source_count uses the
        # same predicate. (GitHub #50)
        cur.execute(
            "SELECT s3_key, id FROM uploads WHERE client_id = %s AND status = 'active'",
            (db_client_id,)
        )
        active_rows = cur.fetchall()
        active_keys = [r[0] for r in active_rows]
        # {s3_key: upload_id (string)} — JSON-serialisable for the async payload
        active_uploads = {r[0]: str(r[1]) for r in active_rows}
        print(f"Active upload keys for enrichment: {len(active_keys)}")

        # Create enrichment tracking record with stage
        cur.execute("""
            INSERT INTO enrichments (client_id, status, stage, engagement_id)
            VALUES (%s, 'processing', 'extracting', %s)
            RETURNING id
        """, (db_client_id, engagement_id))
        enrichment_id = str(cur.fetchone()[0])

        # Reset approval on re-enrichment (engagement-level if scoped, else client-level)
        if engagement_id:
            cur.execute("UPDATE engagements SET approved_at = NULL, approved_by = NULL WHERE id = %s", (engagement_id,))
        else:
            cur.execute("UPDATE clients SET approved_at = NULL, approved_by = NULL WHERE id = %s", (db_client_id,))

        # Load engagement focus_area and contacts if scoped
        engagement_focus_area = None
        engagement_contacts = None
        if engagement_id:
            cur.execute("SELECT focus_area, contacts_json FROM engagements WHERE id = %s", (engagement_id,))
            eng_row = cur.fetchone()
            if eng_row:
                engagement_focus_area = eng_row[0] or None
                engagement_contacts = eng_row[1] or None

        conn.commit()
        cur.close()
        conn.close()

        # Self-invoke async for the heavy lifting
        async_payload = {
            '_async_phase': True,
            'client_id': client_id,
            'db_client_id': db_client_id,
            'enrichment_id': enrichment_id,
            'user_id': user['user_id'],
            'model': model_to_use,
            'active_keys': active_keys,
            'active_uploads': active_uploads,
            'engagement_id': engagement_id,
            'engagement_focus_area': engagement_focus_area,
            'engagement_contacts': engagement_contacts,
        }

        lambda_client.invoke(
            FunctionName=FUNCTION_NAME,
            InvocationType='Event',
            Payload=json.dumps(async_payload)
        )

        print(f"Async enrichment invoked for client: {client_id}, enrichment: {enrichment_id}")

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({
                'job_id': client_id,
                'status': 'processing'
            })
        }

    except Exception as e:
        print(f"Error during enrichment setup: {str(e)}")
        import traceback
        traceback.print_exc()

        if conn:
            try:
                conn.close()
            except Exception:
                pass

        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }


def _run_enrichment_pipeline(event):
    """
    Phase 2: Async enrichment pipeline.
    Runs text extraction, audio transcription, Claude analysis, and writes results.
    """
    client_id = event['client_id']
    db_client_id = event['db_client_id']
    enrichment_id = event['enrichment_id']
    user_id = event['user_id']
    model = event.get('model', 'claude-opus-4-6')
    active_keys = event.get('active_keys', None)
    active_uploads = event.get('active_uploads', None) or {}
    engagement_id = event.get('engagement_id')
    engagement_focus_area = event.get('engagement_focus_area')
    engagement_contacts_raw = event.get('engagement_contacts')

    conn = None

    try:
        conn = get_db_connection()

        # Read client metadata
        cur = conn.cursor()
        cur.execute("""
            SELECT company_name, website_url, contact_name, contact_title,
                   contact_linkedin, industry, description, pain_point,
                   logo_s3_key, icon_s3_key,
                   COALESCE(streamline_webhook_enabled, FALSE),
                   contact_email, contact_phone, contacts_json, addresses_json,
                   streamline_webhook_url, encryption_key
            FROM clients WHERE id = %s
        """, (db_client_id,))
        row = cur.fetchone()
        if not row:
            update_enrichment_stage(conn, enrichment_id, 'error', status='error')
            conn.close()
            return {'status': 'error', 'message': 'Client not found'}

        # Unwrap per-client encryption key
        ck = unwrap_client_key(row[16]) if row[16] else None

        # Snapshot whether poc_scope exists at enrichment start — only flag stale if it did
        had_scope_at_start = False
        try:
            if engagement_id:
                cur.execute("SELECT poc_scope FROM engagements WHERE id = %s", (engagement_id,))
            else:
                cur.execute("SELECT poc_scope FROM clients WHERE s3_folder = %s", (client_id,))
            sr = cur.fetchone()
            had_scope_at_start = bool(sr and sr[0])
        except Exception:
            pass

        company_name = row[0] or 'Unknown Company'
        website = row[1] or ''
        contact_name = row[2] or ''
        contact_title = row[3] or ''
        contact_linkedin = row[4] or ''
        industry = row[5] or ''
        description = row[6] or ''
        pain_point = row[7] or ''
        logo_s3_key = row[8] or ''
        icon_s3_key = row[9] or ''
        streamline_webhook_enabled = bool(row[10])
        contact_email = row[11] or ''
        contact_phone = row[12] or ''

        # Parse contacts_json with legacy fallback
        contacts_json_raw = row[13]
        contacts = []
        if contacts_json_raw:
            try:
                contacts = json.loads(contacts_json_raw) if isinstance(contacts_json_raw, str) else contacts_json_raw
                if not contacts:
                    contacts = []
            except (json.JSONDecodeError, TypeError):
                pass
        if not contacts:
            legacy = {'name': contact_name, 'title': contact_title, 'linkedin': contact_linkedin,
                      'email': contact_email, 'phone': contact_phone}
            if any(legacy.values()):
                contacts = [legacy]

        # Parse addresses_json
        addresses_json_raw = row[14]
        addresses = []
        if addresses_json_raw:
            try:
                addresses = json.loads(addresses_json_raw) if isinstance(addresses_json_raw, str) else addresses_json_raw
                if not addresses:
                    addresses = []
            except (json.JSONDecodeError, TypeError):
                pass

        # Merge engagement contacts if scoped
        if engagement_contacts_raw:
            try:
                eng_contacts = json.loads(engagement_contacts_raw) if isinstance(engagement_contacts_raw, str) else engagement_contacts_raw
                if not eng_contacts:
                    eng_contacts = []
                if eng_contacts:
                    contacts = eng_contacts + contacts
                    print(f"Merged {len(eng_contacts)} engagement contacts with {len(contacts) - len(eng_contacts)} company contacts")
            except (json.JSONDecodeError, TypeError):
                pass

        streamline_webhook_url = row[15] or ''
        if not streamline_webhook_url:
            streamline_webhook_url = _get_system_config_value(conn, 'enrichment_webhook_url')

        # Load system skills from DB first, fall back to bundled files
        system_skills = load_system_skills_from_db(cur)
        if not system_skills:
            print("No system skills in DB, falling back to bundled files")
            system_skills = load_system_skills()
        print(f"Loaded {len(system_skills)} system skills")

        # Read domain/client skills (decrypt with client key)
        skills = read_skills_from_db(cur, db_client_id, client_id, client_key=ck)
        print(f"Loaded {len(skills)} client skills for: {client_id}")
        s3_enc = is_s3_encryption_enabled(cur)
        cur.close()

        # Read client-config.md if it exists (decrypt with client key)
        client_config = read_client_config(client_id, client_key=ck)
        if client_config:
            print(f"Loaded client-config.md ({len(client_config)} chars)")
        else:
            print("No client-config.md found")

        # Stage: extracting (decrypt uploaded files with client key)
        update_enrichment_stage(conn, enrichment_id, 'extracting')
        extracted_text = extract_all_files(client_id, active_keys=active_keys, client_key=ck)
        print(f"Extracted text from {len(extracted_text)} files")

        # Stage: transcribing
        audio_files = find_audio_files(client_id)
        if audio_files:
            update_enrichment_stage(conn, enrichment_id, 'transcribing')
            print(f"Found {len(audio_files)} audio files to transcribe")
            transcripts = transcribe_audio_files(client_id, audio_files, client_key=ck, _s3_enc_flag=s3_enc)
            # Merge transcripts into extracted_text
            for filename, transcript in transcripts.items():
                extracted_text[filename] = transcript
            print(f"Transcribed {len(transcripts)} audio files")
        else:
            print("No audio files found, skipping transcription stage")

        if not extracted_text:
            print("No uploaded documents — enrichment will use organization profile only")
            extracted_text = {
                "_profile_only": "No client documents uploaded — analysis based on organization profile and contact information only."
            }

        # Stage: stage1_per_doc (Stage 1 per-document structured extraction).
        # Each file gets its own Claude call (Haiku, parallel), cached on
        # (upload_id, etag, prompt_version). Stage 2 consumes the structured
        # output instead of raw concatenated text.
        update_enrichment_stage(conn, enrichment_id, 'preprocessing')
        upload_meta = _build_upload_meta(client_id, active_uploads)
        # Stage 1 and Stage 2 both use the same resolved model — the value
        # `model_to_use` set in Phase 1 (which honours request body →
        # users.preferred_model → fallback) and threaded through the async
        # payload as `model`. No hardcoded model identifier here.
        try:
            stage1_summaries = run_stage1_parallel(
                extracted_text,
                upload_meta,
                conn,
                model_id=BEDROCK_MODEL_MAP[model],
                bedrock_invoker=_bedrock_invoke_for_stage1,
            )
        except Stage1FailedError as s1err:
            # Halt — do NOT proceed to Stage 2 with a partial input set.
            # Mark the enrichment failed and surface the error. Successful
            # per-file Stage 1 outputs are already cached in document_analyses
            # so a subsequent retry skips the work that did complete.
            error_text = str(s1err)
            print(f"Halting enrichment {enrichment_id}: {error_text}")
            _mark_enrichment_failed(conn, enrichment_id, 'stage1_failed', error_text)
            conn.close()
            return {'status': 'failed', 'stage': 'stage1', 'message': error_text,
                    'failures': s1err.failures}

        # Stage: researching (placeholder for future web research)
        update_enrichment_stage(conn, enrichment_id, 'researching')
        print("Research stage: placeholder (no web research yet)")

        # Stage: analyzing
        update_enrichment_stage(conn, enrichment_id, 'analyzing')
        print(f"Analyzing {len(extracted_text)} source(s) for client: {client_id}")
        analysis = analyze_with_claude(
            company_name, website, contact_name, contact_title,
            contact_linkedin, industry, description, pain_point, extracted_text, skills,
            model=model, client_config=client_config, system_skills=system_skills,
            contacts=contacts, focus_area=engagement_focus_area,
            stage1_summaries=stage1_summaries, client_id=client_id,
        )

        # Back-compat + integrity: ensure sources[] covers every input filename
        # and that the legacy reference field is populated.
        analysis = _normalise_sources(analysis, stage1_summaries)

        # Write results to S3 (optionally encrypted with client key)
        if engagement_id:
            results_key = f"{client_id}/engagements/{engagement_id}/results/analysis.json"
        else:
            results_key = f"{client_id}/results/analysis.json"
        results_body = json.dumps(analysis, indent=2)
        s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=results_key,
            Body=maybe_encrypt_s3_body(ck, results_body, enabled=s3_enc),
            ContentType='application/octet-stream'
        )

        # Stage: complete
        cur2 = conn.cursor()
        cur2.execute("""
            UPDATE enrichments
            SET status = 'complete', stage = 'complete', completed_at = NOW(), results_s3_key = %s
            WHERE id = %s
        """, (results_key, enrichment_id))
        conn.commit()
        cur2.close()
        conn.close()

        print(f"Analysis complete for client: {client_id}")

        # Check if POC scope needs review after re-enrichment (don't auto-clear)
        # Only flag if scope existed BEFORE enrichment started — not if it was just saved
        try:
            conn3 = get_db_connection()
            cur3 = conn3.cursor()
            if not had_scope_at_start:
                print(f"No poc_scope at enrichment start for {client_id} — skipping stale-scope check")
                cur3.close()
                conn3.close()
            else:
                if engagement_id:
                    cur3.execute("SELECT poc_scope FROM engagements WHERE id = %s", (engagement_id,))
                else:
                    cur3.execute("SELECT poc_scope FROM clients WHERE s3_folder = %s", (client_id,))
                scope_row = cur3.fetchone()
                if scope_row and scope_row[0]:
                    saved_scope = scope_row[0] if isinstance(scope_row[0], dict) else json.loads(scope_row[0])
                    saved_problem_ids = set(saved_scope.get('problems', []))
                    new_problem_ids = set()
                    for p in analysis.get('problems', []):
                        title = p.get('title', '')
                        slug = re.sub(r'[^a-z0-9\s-]', '', title.lower())
                        slug = re.sub(r'\s+', '-', slug).strip('-') or 'unknown'
                        new_problem_ids.add(slug)
                    intersection = saved_problem_ids.intersection(new_problem_ids)
                    if saved_problem_ids and intersection != saved_problem_ids:
                        # Scope is stale — flag for review, don't clear
                        if engagement_id:
                            cur3.execute("UPDATE engagements SET scope_review_needed = TRUE WHERE id = %s", (engagement_id,))
                        conn3.commit()
                        dropped = saved_problem_ids - intersection
                        print(f"POC scope review needed — {len(dropped)} problem IDs changed after re-enrichment for {client_id}: {dropped}")
                cur3.close()
                conn3.close()
        except Exception as scope_err:
            print(f"Non-fatal: scope staleness check failed: {scope_err}")

        # Fire webhook to Streamline (non-blocking — enrichment success is independent)
        # Per-client toggle takes priority; fall back to system-level toggle
        webhook_should_fire = streamline_webhook_enabled
        if not webhook_should_fire:
            sys_enabled = _get_system_config_value(None, 'streamline_webhook_enabled')
            webhook_should_fire = sys_enabled == 'true'
            if webhook_should_fire:
                print("Using system-level streamline_webhook_enabled=true (no per-client override)")

        if webhook_should_fire:
            _send_streamline_webhook(
                company_name=company_name,
                contacts=contacts,
                model=model,
                analysis=analysis,
                source_files=list(extracted_text.keys()),
                logo_s3_key=logo_s3_key,
                icon_s3_key=icon_s3_key,
                addresses=addresses,
                webhook_url=streamline_webhook_url
            )
        else:
            print("Streamline webhook disabled (per-client OFF, system default OFF)")

        return {'status': 'complete', 'client_id': client_id}

    except Exception as e:
        print(f"Error during enrichment pipeline: {str(e)}")
        import traceback
        traceback.print_exc()

        if conn:
            try:
                update_enrichment_stage(conn, enrichment_id, 'error', status='error')
            except Exception:
                pass
            try:
                conn.close()
            except Exception:
                pass

        return {'status': 'error', 'message': str(e)}


def _handle_send_to_streamline(event):
    """
    POST /send-to-streamline
    Re-sends the latest enrichment results to Streamline webhook
    without re-running enrichment.
    """
    user, err = require_auth(event)
    if err:
        return err

    conn = None
    try:
        body = json.loads(event.get('body', '{}'))
        client_id = body.get('client_id', '').strip()

        if not client_id:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'client_id is required'})
            }

        # Read client metadata from DB
        conn = get_db_connection()
        cur = conn.cursor()

        # PR 3.4b: share-aware access.
        frag, frag_params = clients_where_fragment(user, alias='c')
        cur.execute(f"""
            SELECT c.company_name, c.contact_name, c.contact_title, c.id,
                   e.results_s3_key, c.logo_s3_key, c.icon_s3_key,
                   c.contact_email, c.contact_phone, c.contacts_json,
                   c.contact_linkedin, c.addresses_json, c.streamline_webhook_url,
                   c.encryption_key
            FROM clients c
            LEFT JOIN enrichments e ON e.client_id = c.id AND e.status = 'complete'
            WHERE c.s3_folder = %s AND ({frag})
            ORDER BY e.completed_at DESC
            LIMIT 1
        """, (client_id,) + frag_params)

        row = cur.fetchone()

        if not row:
            cur.close()
            conn.close()
            return {
                'statusCode': 404,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Client or enrichment not found'})
            }

        # Unwrap per-client encryption key
        ck = unwrap_client_key(row[13]) if row[13] else None

        company_name = row[0] or 'Unknown Company'
        contact_name = row[1] or ''
        contact_title = row[2] or ''
        results_s3_key = row[4]
        logo_s3_key = row[5] or ''
        icon_s3_key = row[6] or ''
        contact_email = row[7] or ''
        contact_phone = row[8] or ''

        # Parse contacts_json with legacy fallback
        contacts_json_raw = row[9]
        contact_linkedin = row[10] or ''
        contacts = []
        if contacts_json_raw:
            try:
                contacts = json.loads(contacts_json_raw) if isinstance(contacts_json_raw, str) else contacts_json_raw
                if not contacts:
                    contacts = []
            except (json.JSONDecodeError, TypeError):
                pass
        if not contacts:
            legacy = {'name': contact_name, 'title': contact_title, 'linkedin': contact_linkedin,
                      'email': contact_email, 'phone': contact_phone}
            if any(legacy.values()):
                contacts = [legacy]

        # Parse addresses_json
        addresses_json_raw = row[11]
        addresses = []
        if addresses_json_raw:
            try:
                addresses = json.loads(addresses_json_raw) if isinstance(addresses_json_raw, str) else addresses_json_raw
                if not addresses:
                    addresses = []
            except (json.JSONDecodeError, TypeError):
                pass

        manual_webhook_url = row[12] or ''
        if not manual_webhook_url:
            manual_webhook_url = _get_system_config_value(conn, 'enrichment_webhook_url')

        cur.close()
        conn.close()

        if not results_s3_key:
            return {
                'statusCode': 404,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'No enrichment results found for this client'})
            }

        # Read results from S3
        s3_resp = s3_client.get_object(Bucket=BUCKET_NAME, Key=results_s3_key)
        analysis = json.loads(s3_resp['Body'].read().decode('utf-8'))

        source_files = analysis.get('analyzed_files', [])
        model_used = analysis.get('model', 'unknown')

        # Send to Streamline
        _send_streamline_webhook(
            company_name=company_name,
            contacts=contacts,
            model=model_used,
            analysis=analysis,
            source_files=source_files,
            logo_s3_key=logo_s3_key,
            icon_s3_key=icon_s3_key,
            addresses=addresses,
            webhook_url=manual_webhook_url
        )

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'message': 'Results sent to Streamline', 'status': 'sent'})
        }

    except Exception as e:
        print(f"Error in send-to-streamline: {str(e)}")
        if conn:
            try:
                conn.close()
            except Exception:
                pass
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': str(e)})
        }


def update_enrichment_stage(conn, enrichment_id, stage, status=None):
    """Update the enrichment stage (and optionally status) in DB."""
    try:
        cur = conn.cursor()
        if status:
            cur.execute("""
                UPDATE enrichments SET stage = %s, status = %s, completed_at = NOW()
                WHERE id = %s
            """, (stage, status, enrichment_id))
        else:
            cur.execute("""
                UPDATE enrichments SET stage = %s WHERE id = %s
            """, (stage, enrichment_id))
        conn.commit()
        cur.close()
        print(f"Stage updated: {stage}")
    except Exception as e:
        print(f"Error updating stage to {stage}: {e}")


def _mark_enrichment_failed(conn, enrichment_id, stage, error_message):
    """Mark an enrichment row as failed with a stage tag and error message.

    Used when Stage 1 cannot complete and the pipeline must halt without
    writing a degraded analysis JSON. error_message is truncated to keep
    the column from carrying multi-megabyte stack traces."""
    try:
        cur = conn.cursor()
        cur.execute("""
            UPDATE enrichments
            SET status = 'failed', stage = %s, completed_at = NOW(),
                error_message = %s
            WHERE id = %s
        """, (stage, (error_message or '')[:4000], enrichment_id))
        conn.commit()
        cur.close()
        print(f"Enrichment {enrichment_id} marked failed at stage={stage}")
    except Exception as e:
        print(f"Error marking enrichment {enrichment_id} failed: {e}")


def find_audio_files(client_id):
    """List audio files in the client's uploads folder.

    Paginated — list_objects_v2 returns at most 1000 keys per page; without
    the loop, any client with > 1000 uploads silently loses audio files
    sitting past the first page. (GitHub #49)
    """
    audio_files = []
    try:
        paginator = s3_client.get_paginator('list_objects_v2')
        for page in paginator.paginate(Bucket=BUCKET_NAME, Prefix=f"{client_id}/uploads/"):
            for obj in page.get('Contents', []):
                key = obj['Key']
                filename = key.split('/')[-1]
                if not filename:
                    continue
                ext = filename.lower().rsplit('.', 1)[-1] if '.' in filename else ''
                if ext in AUDIO_EXTENSIONS:
                    audio_files.append(key)
    except Exception as e:
        print(f"Error listing audio files: {e}")
    return audio_files


def read_audio_context(client_id, filename):
    """Read {filename}.context.json from S3 uploads folder if it exists."""
    context_key = f"{client_id}/uploads/{filename}.context.json"
    try:
        response = s3_client.get_object(Bucket=BUCKET_NAME, Key=context_key)
        return json.loads(response['Body'].read().decode('utf-8'))
    except Exception:
        return None


def transcribe_audio_files(client_id, audio_s3_keys, client_key=None, _s3_enc_flag=True):
    """Transcribe all audio files using AWS Transcribe. Returns {filename: transcript_text}."""
    transcripts = {}
    for s3_key in audio_s3_keys:
        filename = s3_key.split('/')[-1]
        try:
            transcript = transcribe_single_file(client_id, s3_key, filename)
            if transcript:
                # Build header with context if available
                ctx = read_audio_context(client_id, filename)
                if ctx:
                    header_parts = [f"Audio Transcript ({filename})"]
                    if ctx.get('date'):
                        header_parts.append(f"Date: {ctx['date']}")
                    if ctx.get('participants'):
                        header_parts.append(f"Participants: {ctx['participants']}")
                    if ctx.get('topic'):
                        header_parts.append(f"Topic: {ctx['topic']}")
                    header = " -- ".join(header_parts)
                else:
                    header = f"Audio Transcript ({filename})"

                transcripts[filename] = f"{header}\n\n{transcript}"
                # Save transcript to extracted folder (optionally encrypted)
                transcript_key = f"{client_id}/extracted/{filename}.transcript.txt"
                s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=transcript_key,
                    Body=maybe_encrypt_s3_body(client_key, transcript, enabled=_s3_enc_flag),
                    ContentType='application/octet-stream'
                )
                print(f"Saved transcript: {transcript_key}")
        except Exception as e:
            print(f"Error transcribing {filename}: {e}")
    return transcripts


def transcribe_single_file(client_id, s3_key, filename):
    """Start and poll an AWS Transcribe job for a single audio file."""
    # Build job name: xo-{client_id_suffix}-{safe_filename}-{uuid}
    client_suffix = client_id[-12:] if len(client_id) > 12 else client_id
    safe_filename = re.sub(r'[^a-zA-Z0-9._-]', '_', filename.rsplit('.', 1)[0])
    job_name = f"xo-{client_suffix}-{safe_filename}-{uuid.uuid4().hex[:8]}"
    job_name = job_name[:200]  # Transcribe max job name length

    ext = filename.lower().rsplit('.', 1)[-1]
    media_format_map = {
        'mp3': 'mp3', 'wav': 'wav', 'm4a': 'mp4', 'aac': 'mp4',
        'ogg': 'ogg', 'flac': 'flac', 'wma': 'mp3',
        'mp4': 'mp4', 'webm': 'webm'
    }
    media_format = media_format_map.get(ext, 'mp3')

    media_uri = f"s3://{BUCKET_NAME}/{s3_key}"
    output_key = f"{client_id}/extracted/.transcribe-output/{filename}.json"

    print(f"Starting transcription job: {job_name} for {filename}")

    transcribe_client.start_transcription_job(
        TranscriptionJobName=job_name,
        Media={'MediaFileUri': media_uri},
        MediaFormat=media_format,
        LanguageCode='en-US',
        OutputBucketName=BUCKET_NAME,
        OutputKey=output_key
    )

    # Poll for completion (max 360s — video files can take 2-5 min)
    max_wait = 360
    elapsed = 0
    while elapsed < max_wait:
        time.sleep(5)
        elapsed += 5

        response = transcribe_client.get_transcription_job(
            TranscriptionJobName=job_name
        )
        status = response['TranscriptionJob']['TranscriptionJobStatus']

        if status == 'COMPLETED':
            print(f"Transcription complete: {job_name} ({elapsed}s)")
            return read_transcribe_output(output_key)
        elif status == 'FAILED':
            reason = response['TranscriptionJob'].get('FailureReason', 'Unknown')
            print(f"Transcription failed: {job_name} - {reason}")
            return None

        print(f"Transcription in progress: {job_name} ({elapsed}s)")

    print(f"Transcription timed out: {job_name} after {max_wait}s")
    return None


def read_transcribe_output(output_key):
    """Read and parse AWS Transcribe output JSON from S3."""
    try:
        response = s3_client.get_object(Bucket=BUCKET_NAME, Key=output_key)
        output = json.loads(response['Body'].read().decode('utf-8'))
        transcripts = output.get('results', {}).get('transcripts', [])
        if transcripts:
            return transcripts[0].get('transcript', '')
        return ''
    except Exception as e:
        print(f"Error reading transcribe output ({output_key}): {e}")
        return None


def load_system_skills_from_db(cur):
    """Load system skills from DB (client_id IS NULL), with S3 fallback for content."""
    skills = []
    try:
        cur.execute("SELECT name, content, s3_key FROM skills WHERE client_id IS NULL ORDER BY name")
        for row in cur.fetchall():
            name, content, s3_key = row[0], row[1], row[2]
            if not content and s3_key:
                try:
                    obj = s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
                    content = obj['Body'].read().decode('utf-8')
                except Exception as e:
                    print(f"Failed to load system skill from S3 ({s3_key}): {e}")
                    continue
            if content:
                skills.append({'name': name, 'content': content})
    except Exception as e:
        print(f"Error loading system skills from DB: {e}")
    return skills


def load_system_skills():
    """Load system skills from the bundled system-skills/ directory (fallback)."""
    skills = []
    try:
        if not os.path.isdir(SYSTEM_SKILLS_DIR):
            print(f"System skills directory not found: {SYSTEM_SKILLS_DIR}")
            return skills
        for filename in sorted(os.listdir(SYSTEM_SKILLS_DIR)):
            if not filename.endswith('.md'):
                continue
            filepath = os.path.join(SYSTEM_SKILLS_DIR, filename)
            with open(filepath, 'r') as f:
                content = f.read()
            skills.append({
                'name': filename.replace('.md', ''),
                'content': content
            })
    except Exception as e:
        print(f"Error loading system skills: {e}")
    return skills


def read_client_config(client_id, client_key=None):
    """Read client-config.md from S3 if it exists. Decrypts with client key."""
    try:
        response = s3_client.get_object(
            Bucket=BUCKET_NAME,
            Key=f"{client_id}/client-config.md"
        )
        raw = response['Body'].read()
        return maybe_decrypt_s3_body(client_key, raw)
    except Exception:
        return None


def read_skills_from_db(cur, db_client_id, client_id, client_key=None):
    """Read skills from DB, with S3 fallback for s3_key-only skills."""
    skills = []

    try:
        cur.execute("""
            SELECT name, content, s3_key FROM skills WHERE client_id = %s
        """, (str(db_client_id),))

        for row in cur.fetchall():
            name, content, s3_key = row

            if content:
                skills.append({'name': name, 'content': content})
            elif s3_key:
                # Fallback: read from S3 (decrypt with client key)
                try:
                    file_obj = s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
                    raw = file_obj['Body'].read()
                    skill_content = maybe_decrypt_s3_body(client_key, raw)
                    skills.append({'name': name, 'content': skill_content})
                except Exception as e:
                    print(f"Error reading skill from S3 ({s3_key}): {e}")

    except Exception as e:
        print(f"Error reading skills from DB: {e}")
        # Fallback to S3 listing
        skills = read_skills_from_s3(client_id, client_key=client_key)

    return skills


def read_skills_from_s3(client_id, client_key=None):
    """Fallback: Read all skill files from S3 skills folder.

    Paginated — see find_audio_files note. (GitHub #49)
    """
    skills = []

    try:
        paginator = s3_client.get_paginator('list_objects_v2')
        for page in paginator.paginate(Bucket=BUCKET_NAME, Prefix=f"{client_id}/skills/"):
            for obj in page.get('Contents', []):
                key = obj['Key']
                filename = key.split('/')[-1]

                if not filename or not filename.endswith('.md'):
                    continue

                file_obj = s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
                raw = file_obj['Body'].read()
                skill_content = maybe_decrypt_s3_body(client_key, raw)
                skills.append({
                    'name': filename.replace('.md', ''),
                    'content': skill_content
                })

    except Exception as e:
        print(f"Error reading skills from S3: {e}")

    return skills


def extract_all_files(client_id, active_keys=None, client_key=None):
    """Extract text from all uploaded files. If active_keys provided, only process those.

    Paginated — list_objects_v2 returns at most 1000 keys per page; without
    the loop, any client with > 1000 uploads silently loses files past the
    first page. (GitHub #49)
    """
    extracted_text = {}
    active_keys_set = set(active_keys) if active_keys else None

    try:
        paginator = s3_client.get_paginator('list_objects_v2')
        for page in paginator.paginate(Bucket=BUCKET_NAME, Prefix=f"{client_id}/uploads/"):
            for obj in page.get('Contents', []):
                key = obj['Key']
                filename = key.split('/')[-1]

                if not filename or filename == '':
                    continue

                # Skip context metadata files (uploaded alongside audio)
                if filename.endswith('.context.json'):
                    continue

                # Filter by active keys if provided
                if active_keys_set is not None and key not in active_keys_set:
                    print(f"Skipping inactive/deleted file: {filename}")
                    continue

                # Skip audio files — handled by Transcribe stage
                ext = filename.lower().rsplit('.', 1)[-1] if '.' in filename else ''
                if ext in AUDIO_EXTENSIONS:
                    print(f"Audio file — will be handled by Transcribe: {filename}")
                    continue

                print(f"Processing file: {filename}")

                file_obj = s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
                file_content = file_obj['Body'].read()

                # Decrypt if encrypted with client key (handles ENC:/ENCB: prefix detection)
                file_content = maybe_decrypt_s3_bytes(client_key, file_content)

                text = extract_text(filename, file_content)
                if text:
                    extracted_text[filename] = text

    except Exception as e:
        print(f"Error extracting files: {str(e)}")

    return extracted_text


def extract_text(filename, file_content):
    """Extract text from different file types"""
    ext = filename.lower().split('.')[-1]

    try:
        if ext == 'csv':
            return extract_csv(file_content)
        elif ext in ('txt', 'md'):
            return file_content.decode('utf-8', errors='replace')
        elif ext in ['xlsx', 'xls']:
            return extract_excel(file_content)
        elif ext == 'pdf':
            return extract_pdf(file_content)
        elif ext in ['docx', 'doc']:
            return extract_docx(file_content)
        else:
            print(f"Unsupported file type: {ext}")
            return None

    except Exception as e:
        print(f"Error extracting {filename}: {str(e)}")
        return None


def extract_csv(file_content):
    """Extract text from CSV file"""
    try:
        content = file_content.decode('utf-8')
        reader = csv.reader(io.StringIO(content))
        rows = list(reader)

        text = "CSV Data:\n"
        text += f"Total rows: {len(rows)}\n\n"

        if rows:
            text += "Header: " + ", ".join(rows[0]) + "\n\n"
            text += "Sample data (first 10 rows):\n"
            for i, row in enumerate(rows[1:11]):
                text += f"Row {i+1}: " + ", ".join(row) + "\n"

        return text

    except Exception as e:
        print(f"Error parsing CSV: {str(e)}")
        return str(file_content[:1000])


def extract_excel(file_content):
    """Extract text from Excel file"""
    try:
        import openpyxl
        from io import BytesIO

        wb = openpyxl.load_workbook(BytesIO(file_content), data_only=True)
        text = "Excel Data:\n\n"

        for sheet_name in wb.sheetnames:
            sheet = wb[sheet_name]
            text += f"Sheet: {sheet_name}\n"
            text += f"Rows: {sheet.max_row}, Columns: {sheet.max_column}\n\n"

            text += "Sample data (first 10 rows):\n"
            for i, row in enumerate(sheet.iter_rows(max_row=10, values_only=True)):
                text += f"Row {i+1}: " + ", ".join([str(cell) if cell else "" for cell in row]) + "\n"
            text += "\n"

        return text

    except Exception as e:
        print(f"Error parsing Excel: {str(e)}")
        return f"Excel file with {len(file_content)} bytes"


def extract_pdf(file_content):
    """Extract text from PDF file"""
    try:
        from pypdf import PdfReader
        from io import BytesIO

        pdf = PdfReader(BytesIO(file_content))
        text = f"PDF Document ({len(pdf.pages)} pages):\n\n"

        for i, page in enumerate(pdf.pages[:10]):
            page_text = page.extract_text()
            if page_text:
                text += f"--- Page {i+1} ---\n{page_text}\n\n"

        return text

    except Exception as e:
        print(f"Error parsing PDF: {str(e)}")
        return f"PDF file with {len(file_content)} bytes"


def extract_docx(file_content):
    """Extract text from Word .docx file"""
    try:
        from docx import Document
        from io import BytesIO

        doc = Document(BytesIO(file_content))
        text = f"Word Document ({len(doc.paragraphs)} paragraphs):\n\n"

        for para in doc.paragraphs:
            if para.text.strip():
                text += para.text + "\n"

        # Also extract text from tables
        if doc.tables:
            text += f"\n--- Tables ({len(doc.tables)}) ---\n"
            for i, table in enumerate(doc.tables):
                text += f"\nTable {i+1}:\n"
                for row in table.rows:
                    cells = [cell.text.strip() for cell in row.cells]
                    text += " | ".join(cells) + "\n"

        return text

    except Exception as e:
        print(f"Error parsing DOCX: {str(e)}")
        return f"Word document with {len(file_content)} bytes"


def _send_streamline_webhook(company_name, contacts, model, analysis, source_files, logo_s3_key='', icon_s3_key='', addresses=None, webhook_url=''):
    """
    POST enrichment results to Streamline webhook URL.
    Uses per-client webhook_url if provided, falls back to STREAMLINE_WEBHOOK_URL env var.
    Non-blocking — logs result but never fails the enrichment.
    """
    url = webhook_url or STREAMLINE_WEBHOOK_URL
    if not url:
        print("Streamline webhook: no URL configured (no per-client URL or env var), skipping")
        return

    try:
        import urllib.request

        primary = contacts[0] if contacts else {}
        contact_first = primary.get('firstName', '')
        contact_last = primary.get('lastName', '')
        # Fallback to legacy "name" field if firstName not present
        if not contact_first and primary.get('name'):
            parts = primary['name'].split(' ', 1)
            contact_first = parts[0]
            contact_last = parts[1] if len(parts) > 1 else ''
        contact_name = f"{contact_first} {contact_last}".strip()
        contact_title = primary.get('title', '')
        contact_display = contact_name
        if contact_title:
            contact_display += f" ({contact_title})"

        # Build full contacts array for payload
        contacts_payload = []
        for idx, c in enumerate(contacts):
            c_first = c.get('firstName', '')
            c_last = c.get('lastName', '')
            if not c_first and c.get('name'):
                parts = c['name'].split(' ', 1)
                c_first = parts[0]
                c_last = parts[1] if len(parts) > 1 else ''
            c_full = f"{c_first} {c_last}".strip()
            display = c_full
            if c.get('title'):
                display += f" ({c['title']})"
            contacts_payload.append({
                "first_name": c_first,
                "last_name": c_last,
                "name": c_full,
                "title": c.get('title', ''),
                "email": c.get('email', ''),
                "phone": c.get('phone', ''),
                "linkedin": c.get('linkedin', ''),
                "display": display
            })

        payload = {
            "client_name": company_name,
            # Legacy flat fields from primary contact
            "client_contact": contact_display,
            "client_contact_first_name": contact_first,
            "client_contact_last_name": contact_last,
            "client_email": primary.get('email', ''),
            "client_phone": primary.get('phone', ''),
            # Full contacts array
            "contacts": contacts_payload,
            # Addresses array
            "addresses": addresses or [],
            "enrichment_model": model,
            "enrichment_date": datetime.now(timezone.utc).isoformat(),
            "executive_summary": analysis.get("summary", ""),
            "problems_identified": analysis.get("problems", []),
            "proposed_schema": analysis.get("schema", {}).get("tables", []),
            "action_plan": {
                phase.get("phase", ""): phase.get("actions", [])
                for phase in analysis.get("plan", [])
            },
            "client_summary": analysis.get("client_summary", ""),
            "streamline_applications": analysis.get("streamline_applications", ""),
            "data_sources": analysis.get("sources", []),
            "source_files": source_files,
            "xo_results_url": "https://d2np82m8rfcd6u.cloudfront.net",
            "client_logo_url": f"https://xo-client-data-mv.s3.us-west-1.amazonaws.com/{logo_s3_key}" if logo_s3_key else None,
            "client_icon_url": f"https://xo-client-data-mv.s3.us-west-1.amazonaws.com/{icon_s3_key}" if icon_s3_key else None
        }

        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            url,
            data=data,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        resp = urllib.request.urlopen(req, timeout=10)
        print(f"Streamline webhook: {resp.status} ({len(data)} bytes sent)")

    except Exception as e:
        print(f"Streamline webhook failed (non-fatal): {str(e)}")


def _build_upload_meta(client_id, active_uploads):
    """Build {filename: {upload_id, etag}} by listing the client's uploads
    folder and matching S3 keys against the active_uploads map from Phase 1.

    Reuses the existing list_objects_v2 path (single S3 call, paginated).
    """
    upload_meta = {}
    paginator = s3_client.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=BUCKET_NAME, Prefix=f"{client_id}/uploads/"):
        for obj in page.get('Contents', []):
            s3_key = obj['Key']
            upload_id = active_uploads.get(s3_key)
            if not upload_id:
                continue
            filename = s3_key.split('/')[-1]
            if not filename:
                continue
            etag = (obj.get('ETag') or '').strip('"')
            if not etag:
                continue
            upload_meta[filename] = {'upload_id': upload_id, 'etag': etag}
    return upload_meta


def _bedrock_invoke_for_stage1(model_id, body_str):
    """Bedrock Converse invocation matching whichever auth path the parent
    Lambda is configured for (bearer-token urllib or boto3 IAM converse)."""
    if AWS_BEARER_TOKEN_BEDROCK:
        return _invoke_bedrock_bearer(model_id, body_str)
    body = json.loads(body_str)
    response = bedrock_client.converse(
        modelId=model_id,
        messages=body['messages'],
        inferenceConfig=body.get('inferenceConfig', {}),
    )
    return response


def _normalise_sources(analysis, stage1_summaries):
    """Enforce the source-coverage contract and populate the back-compat
    `reference` field that legacy consumers (Streamline, frontend) expect.

    Contract: sources[] must contain exactly one entry per filename in
    stage1_summaries. Missing filenames are auto-filled with a marker
    indicating Claude omitted them; nothing is silently dropped. The
    legacy `reference` string is composed server-side as
    f"{filename} — {distinctive_fact}" for unchanged consumers.
    """
    if not isinstance(analysis, dict):
        return analysis

    sources = analysis.get('sources') or []
    if not isinstance(sources, list):
        sources = []

    # Index existing entries by filename; tolerate lowercase / whitespace drift.
    by_name = {}
    for s in sources:
        if not isinstance(s, dict):
            continue
        fname = (s.get('filename') or '').strip()
        if fname:
            by_name[fname] = s

    expected = [
        f for f in stage1_summaries.keys()
        if f != '_profile_only'
    ]
    missing = [f for f in expected if f not in by_name]
    if missing:
        print(f"sources[] coverage gap — auto-filling {len(missing)} omitted filename(s): {missing}")
        for f in missing:
            s1 = stage1_summaries.get(f) or {}
            facts = s1.get('distinctive_facts') or []
            entry = {
                'filename': f,
                'type': 'client_data',
                'distinctive_fact': facts[0] if facts else '',
                'consolidated_with': [],
                'unique_angle': '',
                'note': 'Auto-filled — Claude omitted this filename from sources[]',
            }
            sources.append(entry)
            by_name[f] = entry

    # Back-compat: populate legacy `reference` field for any entry missing it.
    for s in sources:
        if not isinstance(s, dict):
            continue
        if 'reference' not in s:
            fname = (s.get('filename') or '').strip()
            fact = (s.get('distinctive_fact') or '').strip()
            s['reference'] = f"{fname} — {fact}" if fname and fact else (fname or '')
        if 'type' not in s:
            s['type'] = 'client_data'
        s.setdefault('consolidated_with', [])
        s.setdefault('unique_angle', '')

    analysis['sources'] = sources
    return analysis


def analyze_with_claude(company_name, website, contact_name, contact_title,
                        contact_linkedin, industry, description, pain_point, extracted_text, skills=None,
                        model='claude-opus-4-6', client_config=None, system_skills=None,
                        contacts=None, focus_area=None, stage1_summaries=None, client_id=None):
    """
    Call Claude API with XO Capture Analysis prompt.
    Returns structured analysis JSON.

    Inputs are formatted from `stage1_summaries` (per-document structured
    output produced by Stage 1). For backward-compat — if no Stage 1 output
    is supplied, falls back to the legacy text[:5000] concat over
    extracted_text. New code paths always supply stage1_summaries.
    """

    if stage1_summaries:
        files_summary = build_stage2_input(stage1_summaries)
    else:
        # Legacy fallback path — kept for safety during deploy and for
        # tests that exercise analyze_with_claude in isolation.
        files_summary = "\n\n".join([
            f"=== {filename} ===\n{text[:5000]}"
            for filename, text in extracted_text.items()
        ])

    enrichment_info = []

    # Engagement focus directive (highest priority — scopes the analysis)
    if focus_area:
        enrichment_info.append(f"ENGAGEMENT FOCUS: {focus_area}. Prioritize this analysis around this specific focus area within the organization. Do not analyze the company's broader operations outside this scope.")

    if website:
        enrichment_info.append(f"Company Website: {website}")

    # Build contact info from contacts array (preferred) or legacy fields
    if contacts and len(contacts) > 0:
        primary = contacts[0]
        display = primary.get('name', '')
        if primary.get('title'):
            display += f" ({primary['title']})"
        if display:
            enrichment_info.append(f"Primary Contact: {display}")
        if primary.get('linkedin'):
            enrichment_info.append(f"Primary Contact LinkedIn: {primary['linkedin']}")
        if primary.get('email'):
            enrichment_info.append(f"Primary Contact Email: {primary['email']}")
        if primary.get('phone'):
            enrichment_info.append(f"Primary Contact Phone: {primary['phone']}")
        for idx, c in enumerate(contacts[1:], start=2):
            display = c.get('name', '')
            if c.get('title'):
                display += f" ({c['title']})"
            if display:
                enrichment_info.append(f"Contact {idx}: {display}")
            if c.get('email'):
                enrichment_info.append(f"Contact {idx} Email: {c['email']}")
    else:
        if contact_name:
            enrichment_info.append(f"Primary Contact: {contact_name}" + (f" ({contact_title})" if contact_title else ""))
        if contact_linkedin:
            enrichment_info.append(f"Contact LinkedIn: {contact_linkedin}")

    if industry:
        enrichment_info.append(f"Industry: {industry}")
    if description:
        enrichment_info.append(f"Description: {description}")
    if pain_point:
        enrichment_info.append(f"Immediate Pain Point: {pain_point}")

    enrichment_section = "\n".join(enrichment_info) if enrichment_info else "Not provided"

    # System skills (always injected first -- analysis framework, output format, authority, enrichment process)
    system_skills_section = ""
    if system_skills and len(system_skills) > 0:
        system_skills_section = "\n\nSYSTEM INSTRUCTIONS (follow these rules for every analysis):\n"
        for skill in system_skills:
            system_skills_section += f"=== {skill['name'].upper().replace('-', ' ')} ===\n{skill['content']}\n\n"

    # Client config section (persistent context, like a CLAUDE.md for this client)
    config_section = ""
    if client_config:
        config_section = f"\n\nCLIENT CONFIGURATION (persistent context for this engagement):\n{client_config}\n"

    # Domain/client skills (editable per client, override defaults)
    skills_section = ""
    if skills and len(skills) > 0:
        skills_section = "\n\nCLIENT-SPECIFIC SKILLS & INSTRUCTIONS:\n"
        skills_section += "The following skills provide domain-specific knowledge and analysis instructions. Follow these instructions carefully -- they refine the system instructions above:\n\n"
        for skill in skills:
            skills_section += f"=== SKILL: {skill['name']} ===\n{skill['content']}\n\n"

    pain_point_section = ""
    if pain_point:
        pain_point_section = f"\n\nPRIORITY: The client has identified this as their immediate pain point: '{pain_point}'. Make this the #1 problem in your analysis. Lead the executive summary with it, ensure it appears first in the problems list with specific evidence and a concrete recommendation, and front-load the 7-day action plan with steps that directly address it."

    prompt = f"""You are an MBA-level business analyst conducting an XO Capture analysis. You have been given access to internal documents from a company. Analyze this business and provide strategic insights.

COMPANY INFORMATION:
Company Name: {company_name}
{enrichment_section}
{config_section}
CLIENT DATA (Per-document structured summaries from Stage 1):
Each block below corresponds to ONE uploaded file and was produced by a per-document extraction pass. Treat each block as the canonical view of that file. Use the DISTINCTIVE FACTS, NAMED ENTITIES, DECISIONS, ACTION ITEMS, and KEY QUOTES verbatim where possible — they are the highest-signal content from each document.

{files_summary}
{skills_section}
TASK:
Analyze this business like an MBA analyst presenting on Monday morning.{pain_point_section}

Provide your analysis covering: Executive Summary, Problems Identified, Proposed Architecture, Component Mapping, Proposed Data Schema, 7/14/21 Day Action Plan, Bottom Line, Client Summary, and Potential Streamline Applications.

ARCHITECTURE DIAGRAM RULES:
The architecture_diagram uses four named bands (NO layer numbers — no "LAYER 1:", "LAYER 2:", etc.). Band labels are in ALL CAPS. Order top to bottom:

DATA SOURCES — Client existing systems tagged [EXISTING] (e.g. Epic, SAP, Salesforce). Below them show ONE Streamline connector per integration platform (e.g. "Streamline Redox Connector" for ALL Epic systems — do NOT create separate connectors per Epic module). Streamline connectors are NOT tagged boxes. Do NOT show "XO Direct" as a connector — omit it from the diagram.

XO RUNTIME PREDICTIVE ANALYSIS — XO components that analyse data, predict, detect, and recommend (e.g. RadiologyFlowEngine [NEW], BottleneckDetector [NEW]). Tag each component [EXISTING], [EXTEND], or [NEW]. XO reads from Data Sources and drives actions through Streamline.

STREAMLINE WORKFLOW ORCHESTRATION — Streamline executes the automated actions XO decides on: notifications, alerts, status sync, transport triggers, schedule proposals. Not tagged.

CONSOLE — ONE unified console box tagged [NEW]. Do NOT show separate view boxes (no DepartmentFlowView, BottleneckAlertView, etc. as individual boxes). Show ONE box with these capabilities listed inside:
  - Unified operational view (patient flow, bay/scanner status, throughput)
  - Streamline workflow action buttons (trigger workflows directly from console)
  - XO Insights (predictive analysis results, recommendations, alerts)
Never use the word "dashboard" — always "console".

Data flow: Data Sources feed XO. XO drives Streamline. Console displays XO's analysis and Streamline's workflow actions to operators.
Every named component box MUST carry [EXISTING], [EXTEND], or [NEW]. Do NOT include a summary caption — it is appended programmatically from component_mapping.summary_line.
{system_skills_section}
SOURCE COVERAGE REQUIREMENT (NON-NEGOTIABLE):
Each DOCUMENT BLOCK above represents ONE uploaded file (the filename appears in its `===` header). Your sources[] array MUST contain exactly one entry per filename — never aggregate multiple filenames into one entry, never silently drop a filename.

For each entry:
  - Set "filename" to the exact filename from the block's `===` header.
  - Set "distinctive_fact" to a verbatim or near-verbatim fact pulled from THAT file's DISTINCTIVE FACTS section. Do not invent. Do not paraphrase to genericness.
  - If a file genuinely overlaps with another (its OVERLAPS WITH section flags this), populate "consolidated_with" with the other filenames AND give an explicit "unique_angle" — what THIS file adds that the others don't (e.g. "anonymised version with Forex Ventures naming", "earlier version pre-correction"). Empty unique_angle is NOT allowed when consolidated_with is non-empty.
  - Otherwise leave consolidated_with as [] and unique_angle as "".

OUTPUT FORMAT:
Return valid JSON. The structure below is the base schema — additional fields instructed by SYSTEM INSTRUCTIONS above are permitted. All text fields can include newline characters (\\n) for formatting. Follow the SYSTEM INSTRUCTIONS above for formatting rules:
{{
  "status": "complete",
  "summary": "Executive summary text",
  "problems": [
    {{
      "title": "Problem Title",
      "severity": "high|medium|low",
      "evidence": "Specific evidence citing data: row counts, dollar amounts, percentages from documents...",
      "recommendation": "Concrete action: do X, expect Y outcome, costs approximately Z..."
    }}
  ],
  "architecture_diagram": "ASCII diagram using +, -, |, v, > characters. Four named bands (no layer numbers): DATA SOURCES, XO RUNTIME PREDICTIVE ANALYSIS, STREAMLINE WORKFLOW ORCHESTRATION, CONSOLE. Tag every component box [EXISTING], [EXTEND], or [NEW]. No summary caption.",
  "component_mapping": {{
    "fits": [
      {{"component": "name", "version": "v1", "capability": "what it covers", "config_notes": "specific config needed"}}
    ],
    "extends": [
      {{"component": "name", "from_version": "v1", "to_version": "v1.1", "capability": "what the extension adds", "extension_notes": "specific work"}}
    ],
    "new_components": [
      {{"proposed_name": "PascalCase", "purpose": "one-line", "justification": "why no existing component fits"}}
    ],
    "summary_line": "N components. X existing (deploy week 1). Y extensions. Z net-new builds."
  }},
  "schema": {{
    "tables": [
      {{
        "name": "table_name",
        "purpose": "what this table manages",
        "columns": [
          {{"name": "column_name", "type": "data_type", "description": "what it stores"}}
        ]
      }}
    ],
    "relationships": [
      "table_a.column -> table_b.column (one-to-many)"
    ]
  }},
  "plan": [
    {{
      "phase": "7-day: Build & Demo",
      "actions": ["1. Specific action with measurable outcome", "2. Another action"]
    }},
    {{
      "phase": "14-day: Validate & Connect",
      "actions": ["1. Specific action with measurable outcome", "2. Another action"]
    }},
    {{
      "phase": "21-day: Deploy or Decide",
      "actions": ["1. Specific action with measurable outcome", "2. Another action"]
    }}
  ],
  "bottom_line": "Bottom line text",
  "client_summary": "Client-facing summary text",
  "streamline_applications": "Streamline workflow applications text",
  "xo_applications": [
    {{
      "title": "Application Title",
      "problem": "Business problem this solves, in the client's language",
      "capability": "XO capability or capabilities applied",
      "integrations": "Existing client tools XO connects to",
      "outcome": "What changes operationally, day-to-day"
    }}
  ],
  "sources": [
    {{
      "filename": "<exact filename from a DOCUMENT BLOCK header>",
      "type": "client_data",
      "distinctive_fact": "<one verbatim or near-verbatim fact pulled from this file's DISTINCTIVE FACTS>",
      "consolidated_with": [],
      "unique_angle": ""
    }}
  ]
}}

Be specific. Use actual data from the documents. Think like a management consultant presenting to the CEO."""

    try:
        bedrock_model_id = BEDROCK_MODEL_MAP.get(model, BEDROCK_MODEL_MAP['claude-opus-4-6'])
        print(f"Invoking Bedrock model: {bedrock_model_id} (requested: {model})")

        converse_body = json.dumps({
            "messages": [
                {"role": "user", "content": [{"text": prompt}]}
            ],
            "inferenceConfig": {
                "maxTokens": 32000,
                "temperature": 0.7
            }
        })

        if AWS_BEARER_TOKEN_BEDROCK:
            # Bearer token auth — direct REST call to Converse API
            response_body = _invoke_bedrock_bearer(bedrock_model_id, converse_body)
        else:
            # IAM role auth — boto3 converse
            bedrock_response = bedrock_client.converse(
                modelId=bedrock_model_id,
                messages=[
                    {"role": "user", "content": [{"text": prompt}]}
                ],
                inferenceConfig={"maxTokens": 32000, "temperature": 0.7}
            )
            response_body = bedrock_response

        response_text = response_body['output']['message']['content'][0]['text']
        stop_reason = response_body.get('stopReason', 'unknown')
        print(f"Bedrock response: {len(response_text)} chars, stop_reason={stop_reason}, model={bedrock_model_id}")

        if '```json' in response_text:
            start = response_text.find('```json') + 7
            end = response_text.find('```', start)
            response_text = response_text[start:end].strip()
        elif '```' in response_text:
            start = response_text.find('```') + 3
            end = response_text.find('```', start)
            response_text = response_text[start:end].strip()

        # Try parsing JSON, with repair for truncated responses
        try:
            analysis = json.loads(response_text)
        except json.JSONDecodeError as je:
            print(f"JSON parse failed at char {je.pos}, attempting repair...")
            analysis = _repair_truncated_json(response_text, client_id=client_id)

        analysis['analyzed_at'] = datetime.now(timezone.utc).isoformat()
        analysis['analyzed_files'] = list(extracted_text.keys())

        return analysis

    except Exception as e:
        print(f"Error calling Bedrock API: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "status": "error",
            "error": str(e),
            "summary": "Analysis failed",
            "problems": [],
            "schema": {"tables": []},
            "plan": [],
            "sources": []
        }


def _repair_truncated_json(text, client_id=None):
    """
    Attempt to repair truncated JSON from Claude (e.g. when max_tokens was hit).
    Closes unclosed strings, arrays, and objects to produce valid JSON.
    """
    print(f"Stage 2 output truncation detected, repair invoked: client_id={client_id}")
    # Strip trailing whitespace/incomplete tokens
    text = text.rstrip()

    # If we're inside an unclosed string, close it
    # Count unescaped quotes to see if we're mid-string
    in_string = False
    i = 0
    while i < len(text):
        c = text[i]
        if c == '\\' and in_string:
            i += 2  # skip escaped char
            continue
        if c == '"':
            in_string = not in_string
        i += 1

    if in_string:
        # Truncate back to the last complete line before the unclosed string,
        # or just close the string
        text += '"'

    # Now close any unclosed brackets/braces
    # Count open vs close for [ ] and { }
    stack = []
    in_str = False
    i = 0
    while i < len(text):
        c = text[i]
        if c == '\\' and in_str:
            i += 2
            continue
        if c == '"':
            in_str = not in_str
        elif not in_str:
            if c in ('{', '['):
                stack.append(c)
            elif c == '}' and stack and stack[-1] == '{':
                stack.pop()
            elif c == ']' and stack and stack[-1] == '[':
                stack.pop()
        i += 1

    # Remove any trailing comma before we close brackets
    text = text.rstrip()
    if text.endswith(','):
        text = text[:-1]

    # Close unclosed brackets in reverse order
    for bracket in reversed(stack):
        if bracket == '{':
            text += '}'
        elif bracket == '[':
            text += ']'

    try:
        result = json.loads(text)
        print(f"JSON repair succeeded — recovered {len(str(result))} chars of analysis")
        return result
    except json.JSONDecodeError as e2:
        print(f"JSON repair failed: {str(e2)}")
        # Last resort: try to extract whatever we can
        raise Exception(f"Could not parse Claude response even after repair: {str(e2)}")
