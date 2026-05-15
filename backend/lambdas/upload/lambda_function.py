"""
XO Platform - Upload Lambda (Method Router)
Handles file upload presigned URLs + Source Library CRUD operations.

Routes:
  POST /upload              -> handle_upload        (presigned URLs + DB record)
  GET  /uploads             -> handle_list_uploads  (list all sources for a client)
  DELETE /uploads/{id}      -> handle_delete_upload (soft-delete + S3 delete)
  PUT  /uploads/{id}/toggle -> handle_toggle_upload (active <-> inactive)
  POST /uploads/{id}/replace -> handle_replace_upload (version replacement)
  POST /upload/branding     -> handle_branding_upload (presigned URL for logo/icon)
  GET  /upload/branding     -> handle_branding_get    (presigned GET URLs for logo/icon)
"""

import json
import os
import boto3
from datetime import datetime, timezone
from auth_helper import require_auth, get_db_connection, CORS_HEADERS, log_activity
from client_access import clients_where_fragment

s3_client = boto3.client('s3')
BUCKET_NAME = os.environ.get('BUCKET_NAME', 'xo-client-data-mv')
URL_EXPIRATION = 3600  # 1 hour


def lambda_handler(event, context):
    """Method router - dispatches to handler based on HTTP method + path."""

    # Handle OPTIONS preflight
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    # Auth check
    user, err = require_auth(event)
    if err:
        log_activity(event, err)
        return err

    method = event.get('httpMethod', '')
    path = event.get('resource', '') or event.get('path', '')

    response = None
    try:
        # POST /upload/branding (must check before generic /upload)
        if method == 'POST' and '/branding' in path:
            response = handle_branding_upload(event, user)

        # GET /upload/branding
        elif method == 'GET' and '/branding' in path:
            response = handle_branding_get(event, user)

        # POST /upload (original endpoint)
        elif method == 'POST' and '/upload' in path and '/uploads' not in path:
            response = handle_upload(event, user)

        # GET /uploads?client_id=X (or ?action=view for presigned URL)
        elif method == 'GET' and '/uploads' in path and '{id}' not in path:
            params = event.get('queryStringParameters') or {}
            if params.get('action') == 'view':
                response = handle_view_upload(event, user)
            else:
                response = handle_list_uploads(event, user)

        # DELETE /uploads/{id}
        elif method == 'DELETE' and '/uploads' in path:
            response = handle_delete_upload(event, user)

        # PUT /uploads/{id}/toggle
        elif method == 'PUT' and '/toggle' in path:
            response = handle_toggle_upload(event, user)

        # POST /uploads/{id}/replace
        elif method == 'POST' and '/replace' in path:
            response = handle_replace_upload(event, user)

        else:
            response = {
                'statusCode': 404,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': f'Unknown route: {method} {path}'})
            }

    except Exception as e:
        print(f"Error in upload lambda: {str(e)}")
        import traceback
        traceback.print_exc()
        response = {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Internal server error', 'message': str(e)})
        }

    log_activity(event, response, user)
    return response


def _verify_client(cur, client_id, user_id, is_admin=False, is_client=False, user_client_id=None, is_account=False, account_id=None, account_role=None):
    """Verify client exists and belongs to user. Returns (db_client_id, s3_folder) or None.

    PR 3.4b: role-fork replaced with shared/client_access fragment so the
    cross-tenant share path is honoured uniformly across lambdas."""
    user = {
        'user_id': user_id, 'is_admin': is_admin, 'is_client': is_client,
        'client_id': user_client_id, 'is_account': is_account,
        'account_id': account_id, 'account_role': account_role,
    }
    frag, params = clients_where_fragment(user, alias='c')
    cur.execute(
        f"SELECT c.id, c.s3_folder FROM clients c WHERE c.s3_folder = %s AND ({frag})",
        (client_id,) + params,
    )
    row = cur.fetchone()
    if row:
        return str(row[0]), row[1]
    return None, None


def _verify_upload_ownership(cur, upload_id, user_id, is_admin=False, is_client=False, user_client_id=None, is_account=False, account_id=None, account_role=None):
    """Verify upload belongs to user via client join. Returns upload row or None.

    PR 3.4b: role-fork replaced with shared/client_access fragment. Added
    account_role kwarg (defaults None; new account_admin recipient-with-share
    path needs it to recognise the cross-tenant share grant)."""
    user = {
        'user_id': user_id, 'is_admin': is_admin, 'is_client': is_client,
        'client_id': user_client_id, 'is_account': is_account,
        'account_id': account_id, 'account_role': account_role,
    }
    frag, params = clients_where_fragment(user, alias='c')
    cur.execute(
        f"""SELECT u.id, u.client_id, u.filename, u.file_type, u.s3_key, u.status,
                   u.file_size, u.version, u.source, c.s3_folder
            FROM uploads u
            JOIN clients c ON u.client_id = c.id
            WHERE u.id = %s AND ({frag})""",
        (upload_id,) + params,
    )
    return cur.fetchone()


# ============================================================
# POST /upload — Generate presigned URLs (original endpoint)
# ============================================================
def handle_upload(event, user):
    body = json.loads(event.get('body', '{}'))
    client_id = body.get('client_id', '').strip()
    files = body.get('files', [])

    if not client_id:
        return {
            'statusCode': 400,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'client_id is required'})
        }

    if not files or not isinstance(files, list):
        return {
            'statusCode': 400,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'files array is required'})
        }

    conn = get_db_connection()
    cur = conn.cursor()

    db_client_id, _ = _verify_client(cur, client_id, user['user_id'], user.get('is_admin', False), user.get('is_client', False), user.get('client_id'), user.get('is_account', False), user.get('account_id'), user.get('account_role'))
    if not db_client_id:
        cur.close()
        conn.close()
        return {
            'statusCode': 404,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Client not found'})
        }

    upload_urls = []
    upload_ids = []

    for file_info in files:
        file_name = file_info.get('name', '')
        file_type = file_info.get('type', 'application/octet-stream')
        file_size = file_info.get('size', None)

        if not file_name:
            continue

        s3_key = f"{client_id}/uploads/{file_name}"

        presigned_url = s3_client.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': BUCKET_NAME,
                'Key': s3_key,
                'ContentType': file_type
            },
            ExpiresIn=URL_EXPIRATION
        )

        upload_urls.append(presigned_url)

        # Record upload in DB with file_size
        cur.execute("""
            INSERT INTO uploads (client_id, filename, file_type, s3_key, file_size, status)
            VALUES (%s, %s, %s, %s, %s, 'active')
            RETURNING id
        """, (db_client_id, file_name, file_type, s3_key, file_size))
        upload_id = str(cur.fetchone()[0])
        upload_ids.append(upload_id)

    conn.commit()
    cur.close()
    conn.close()

    print(f"Generated {len(upload_urls)} presigned URLs for client: {client_id}")

    return {
        'statusCode': 200,
        'headers': CORS_HEADERS,
        'body': json.dumps({
            'upload_urls': upload_urls,
            'upload_ids': upload_ids
        })
    }


# ============================================================
# GET /uploads?action=view&client_id=X&s3_key=X — Presigned GET URL
# ============================================================
def handle_view_upload(event, user):
    params = event.get('queryStringParameters') or {}
    client_id = params.get('client_id', '').strip()
    s3_key = params.get('s3_key', '').strip()

    if not client_id or not s3_key:
        return {
            'statusCode': 400,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'client_id and s3_key query parameters are required'})
        }

    conn = get_db_connection()
    cur = conn.cursor()

    db_client_id, _ = _verify_client(cur, client_id, user['user_id'], user.get('is_admin', False), user.get('is_client', False), user.get('client_id'), user.get('is_account', False), user.get('account_id'), user.get('account_role'))
    if not db_client_id:
        cur.close()
        conn.close()
        return {
            'statusCode': 404,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Client not found'})
        }

    # Verify s3_key belongs to this client
    cur.execute("SELECT id FROM uploads WHERE client_id = %s AND s3_key = %s AND (status IS NULL OR status != 'deleted')", (db_client_id, s3_key))
    if not cur.fetchone():
        cur.close()
        conn.close()
        return {
            'statusCode': 404,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Upload not found'})
        }

    cur.close()
    conn.close()

    CONTENT_TYPES = {
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.mp3': 'audio/mpeg',
        '.mp4': 'video/mp4',
        '.wav': 'audio/wav',
        '.webm': 'video/webm',
        '.csv': 'text/csv',
        '.json': 'application/json',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }

    ext = '.' + s3_key.rsplit('.', 1)[-1].lower() if '.' in s3_key else ''
    content_type = CONTENT_TYPES.get(ext, 'application/octet-stream')

    url = s3_client.generate_presigned_url(
        'get_object',
        Params={
            'Bucket': BUCKET_NAME,
            'Key': s3_key,
            'ResponseContentType': content_type,
            'ResponseContentDisposition': 'inline'
        },
        ExpiresIn=URL_EXPIRATION
    )

    return {
        'statusCode': 200,
        'headers': CORS_HEADERS,
        'body': json.dumps({'url': url})
    }


# ============================================================
# GET /uploads?client_id=X — List all sources for a client
# ============================================================
def handle_list_uploads(event, user):
    params = event.get('queryStringParameters') or {}
    client_id = params.get('client_id', '').strip()

    if not client_id:
        return {
            'statusCode': 400,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'client_id query parameter is required'})
        }

    conn = get_db_connection()
    cur = conn.cursor()

    db_client_id, _ = _verify_client(cur, client_id, user['user_id'], user.get('is_admin', False), user.get('is_client', False), user.get('client_id'), user.get('is_account', False), user.get('account_id'), user.get('account_role'))
    if not db_client_id:
        cur.close()
        conn.close()
        return {
            'statusCode': 404,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Client not found'})
        }

    cur.execute("""
        SELECT id, filename, file_type, s3_key, uploaded_at, source, status,
               file_size, version, parent_upload_id, replaced_at
        FROM uploads
        WHERE client_id = %s AND (status IS NULL OR status != 'deleted')
        ORDER BY uploaded_at DESC
    """, (db_client_id,))

    rows = cur.fetchall()
    uploads = []
    for row in rows:
        uploads.append({
            'id': str(row[0]),
            'filename': row[1],
            'file_type': row[2],
            's3_key': row[3],
            'uploaded_at': row[4].isoformat() if row[4] else None,
            'source': row[5] or 'manual',
            'status': row[6] or 'active',
            'file_size': row[7],
            'version': row[8] or 1,
            'parent_upload_id': str(row[9]) if row[9] else None,
            'replaced_at': row[10].isoformat() if row[10] else None
        })

    cur.close()
    conn.close()

    return {
        'statusCode': 200,
        'headers': CORS_HEADERS,
        'body': json.dumps({'uploads': uploads})
    }


# ============================================================
# DELETE /uploads/{id} — Soft-delete upload + remove from S3
# ============================================================
def handle_delete_upload(event, user):
    path_params = event.get('pathParameters') or {}
    upload_id = path_params.get('id', '').strip()

    if not upload_id:
        return {
            'statusCode': 400,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'upload id is required'})
        }

    conn = get_db_connection()
    cur = conn.cursor()

    row = _verify_upload_ownership(cur, upload_id, user['user_id'], user.get('is_admin', False), user.get('is_client', False), user.get('client_id'), user.get('is_account', False), user.get('account_id'), user.get('account_role'))
    if not row:
        cur.close()
        conn.close()
        return {
            'statusCode': 404,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Upload not found'})
        }

    s3_key = row[4]

    # Soft-delete in DB
    cur.execute("UPDATE uploads SET status = 'deleted' WHERE id = %s", (upload_id,))
    conn.commit()

    # Delete from S3
    try:
        s3_client.delete_object(Bucket=BUCKET_NAME, Key=s3_key)
        print(f"Deleted S3 object: {s3_key}")
    except Exception as e:
        print(f"Warning: failed to delete S3 object {s3_key}: {e}")

    cur.close()
    conn.close()

    return {
        'statusCode': 200,
        'headers': CORS_HEADERS,
        'body': json.dumps({'deleted': True, 'id': upload_id})
    }


# ============================================================
# PUT /uploads/{id}/toggle — Flip active <-> inactive
# ============================================================
def handle_toggle_upload(event, user):
    path_params = event.get('pathParameters') or {}
    upload_id = path_params.get('id', '').strip()

    if not upload_id:
        return {
            'statusCode': 400,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'upload id is required'})
        }

    conn = get_db_connection()
    cur = conn.cursor()

    row = _verify_upload_ownership(cur, upload_id, user['user_id'], user.get('is_admin', False), user.get('is_client', False), user.get('client_id'), user.get('is_account', False), user.get('account_id'), user.get('account_role'))
    if not row:
        cur.close()
        conn.close()
        return {
            'statusCode': 404,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Upload not found'})
        }

    current_status = row[5] or 'active'
    new_status = 'inactive' if current_status == 'active' else 'active'

    cur.execute("UPDATE uploads SET status = %s WHERE id = %s", (new_status, upload_id))
    conn.commit()
    cur.close()
    conn.close()

    print(f"Toggled upload {upload_id}: {current_status} -> {new_status}")

    return {
        'statusCode': 200,
        'headers': CORS_HEADERS,
        'body': json.dumps({'id': upload_id, 'status': new_status})
    }


# ============================================================
# POST /uploads/{id}/replace — Upload new version of a file
# ============================================================
def handle_replace_upload(event, user):
    path_params = event.get('pathParameters') or {}
    upload_id = path_params.get('id', '').strip()

    if not upload_id:
        return {
            'statusCode': 400,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'upload id is required'})
        }

    body = json.loads(event.get('body', '{}'))
    file_name = body.get('name', '').strip()
    file_type = body.get('type', 'application/octet-stream')
    file_size = body.get('size', None)

    if not file_name:
        return {
            'statusCode': 400,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'file name is required'})
        }

    conn = get_db_connection()
    cur = conn.cursor()

    row = _verify_upload_ownership(cur, upload_id, user['user_id'], user.get('is_admin', False), user.get('is_client', False), user.get('client_id'), user.get('is_account', False), user.get('account_id'), user.get('account_role'))
    if not row:
        cur.close()
        conn.close()
        return {
            'statusCode': 404,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Upload not found'})
        }

    parent_client_id = str(row[1])
    parent_version = row[7] or 1
    s3_folder = row[9]

    # Mark parent as replaced
    cur.execute("""
        UPDATE uploads SET status = 'replaced', replaced_at = NOW()
        WHERE id = %s
    """, (upload_id,))

    # Create new version
    new_s3_key = f"{s3_folder}/uploads/{file_name}"
    new_version = parent_version + 1

    cur.execute("""
        INSERT INTO uploads (client_id, filename, file_type, s3_key, file_size, version, parent_upload_id, status)
        VALUES (%s, %s, %s, %s, %s, %s, %s, 'active')
        RETURNING id
    """, (parent_client_id, file_name, file_type, new_s3_key, file_size, new_version, upload_id))

    new_upload_id = str(cur.fetchone()[0])

    # Generate presigned URL for new file
    presigned_url = s3_client.generate_presigned_url(
        'put_object',
        Params={
            'Bucket': BUCKET_NAME,
            'Key': new_s3_key,
            'ContentType': file_type
        },
        ExpiresIn=URL_EXPIRATION
    )

    conn.commit()
    cur.close()
    conn.close()

    print(f"Replaced upload {upload_id} with {new_upload_id} (v{new_version})")

    return {
        'statusCode': 200,
        'headers': CORS_HEADERS,
        'body': json.dumps({
            'upload_url': presigned_url,
            'upload_id': new_upload_id,
            'version': new_version,
            'parent_upload_id': upload_id
        })
    }


# ============================================================
# POST /upload/branding — Generate presigned URL for logo/icon
# ============================================================
def handle_branding_upload(event, user):
    body = json.loads(event.get('body', '{}'))
    client_id = body.get('client_id', '').strip()
    file_type = body.get('file_type', '').strip()  # "logo" or "icon"
    content_type = body.get('content_type', 'image/png').strip()
    file_extension = body.get('file_extension', 'png').strip().lstrip('.')

    if not client_id:
        return {
            'statusCode': 400,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'client_id is required'})
        }

    contact_index = body.get('contact_index')
    if file_type not in ('logo', 'icon') and not (file_type == 'contact_photo' and contact_index is not None):
        return {
            'statusCode': 400,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'file_type must be "logo", "icon", or "contact_photo" with contact_index'})
        }

    allowed_types = {'image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'}
    if content_type not in allowed_types:
        return {
            'statusCode': 400,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': f'Unsupported content_type. Allowed: {", ".join(allowed_types)}'})
        }

    conn = get_db_connection()
    cur = conn.cursor()

    # Team photo uploads use _system path -- skip client verification for admins
    if client_id == '_system' and file_type == 'contact_photo':
        if not user.get('is_admin', False) and user.get('account_role') not in ('super_admin', 'account_admin'):
            cur.close()
            conn.close()
            return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Admin required for team photos'})}
        db_client_id = None
    else:
        db_client_id, _ = _verify_client(cur, client_id, user['user_id'], user.get('is_admin', False), user.get('is_client', False), user.get('client_id'), user.get('is_account', False), user.get('account_id'), user.get('account_role'))
        if not db_client_id:
            cur.close()
            conn.close()
            return {
                'statusCode': 404,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Client not found'})
            }

    if file_type == 'contact_photo':
        s3_key = f"{client_id}/contacts/{contact_index}_photo.{file_extension}"
    else:
        s3_key = f"{client_id}/branding/{file_type}.{file_extension}"

    presigned_url = s3_client.generate_presigned_url(
        'put_object',
        Params={
            'Bucket': BUCKET_NAME,
            'Key': s3_key,
            'ContentType': content_type
        },
        ExpiresIn=URL_EXPIRATION
    )

    # Update the appropriate column in clients table (skip for contact photos -- stored in contacts_json)
    if file_type != 'contact_photo':
        column = 'logo_s3_key' if file_type == 'logo' else 'icon_s3_key'
        cur.execute(
            f"UPDATE clients SET {column} = %s, updated_at = NOW() WHERE id = %s",
            (s3_key, db_client_id)
        )
    conn.commit()
    cur.close()
    conn.close()

    print(f"Generated branding upload URL for {file_type}: {s3_key}")

    response_body = {
        'upload_url': presigned_url,
        's3_key': s3_key
    }
    # For contact photos, include a presigned GET URL so the frontend can display the image after upload
    if file_type == 'contact_photo':
        response_body['view_url'] = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': BUCKET_NAME, 'Key': s3_key},
            ExpiresIn=URL_EXPIRATION
        )

    return {
        'statusCode': 200,
        'headers': CORS_HEADERS,
        'body': json.dumps(response_body)
    }


# ============================================================
# GET /upload/branding?client_id=X — Get presigned GET URLs for logo/icon
# ============================================================
def handle_branding_get(event, user):
    params = event.get('queryStringParameters') or {}
    client_id = params.get('client_id', '').strip()

    if not client_id:
        return {
            'statusCode': 400,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'client_id query parameter is required'})
        }

    conn = get_db_connection()
    cur = conn.cursor()

    db_client_id, _ = _verify_client(cur, client_id, user['user_id'], user.get('is_admin', False), user.get('is_client', False), user.get('client_id'), user.get('is_account', False), user.get('account_id'), user.get('account_role'))
    if not db_client_id:
        cur.close()
        conn.close()
        return {
            'statusCode': 404,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Client not found'})
        }

    cur.execute(
        "SELECT logo_s3_key, icon_s3_key FROM clients WHERE id = %s",
        (db_client_id,)
    )
    row = cur.fetchone()
    cur.close()
    conn.close()

    logo_s3_key = row[0] if row else None
    icon_s3_key = row[1] if row else None

    logo_url = None
    icon_url = None

    if logo_s3_key:
        logo_url = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': BUCKET_NAME, 'Key': logo_s3_key},
            ExpiresIn=URL_EXPIRATION
        )

    if icon_s3_key:
        icon_url = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': BUCKET_NAME, 'Key': icon_s3_key},
            ExpiresIn=URL_EXPIRATION
        )

    return {
        'statusCode': 200,
        'headers': CORS_HEADERS,
        'body': json.dumps({
            'logo_url': logo_url,
            'icon_url': icon_url,
            'logo_s3_key': logo_s3_key,
            'icon_s3_key': icon_s3_key
        })
    }
