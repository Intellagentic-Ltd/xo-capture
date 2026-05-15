"""
XO Platform - Google Drive Import Lambda
Routes:
  GET  /gdrive/auth-url  - Returns Google OAuth consent URL
  POST /gdrive/callback  - Exchanges auth code for tokens, stores refresh token
  GET  /gdrive/files      - Lists files in user's Drive
  POST /gdrive/import     - Downloads Drive files → uploads to S3
"""

import json
import os
import io
import boto3
from datetime import datetime, timezone

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

from auth_helper import require_auth, get_db_connection, CORS_HEADERS, log_activity
from client_access import clients_where_fragment
try:
    from crypto_helper import encrypt, decrypt, unwrap_client_key, encrypt_s3_bytes, maybe_encrypt_s3_bytes, is_s3_encryption_enabled
except ImportError:
    def encrypt(x): return x
    def decrypt(x): return x
    def unwrap_client_key(x): return None
    def encrypt_s3_bytes(k, d): return d
    def maybe_encrypt_s3_bytes(k, d, enabled=True): return encrypt_s3_bytes(k, d) if enabled else d
    def is_s3_encryption_enabled(cur): return True

GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')
GOOGLE_REDIRECT_URI = os.environ.get('GOOGLE_REDIRECT_URI', 'https://d2np82m8rfcd6u.cloudfront.net/')
BUCKET_NAME = os.environ.get('BUCKET_NAME', 'xo-client-data-mv')

SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

# Google Docs export MIME types
EXPORT_MIME_TYPES = {
    'application/vnd.google-apps.document': ('application/pdf', '.pdf'),
    'application/vnd.google-apps.spreadsheet': ('text/csv', '.csv'),
    'application/vnd.google-apps.presentation': ('application/pdf', '.pdf'),
    'application/vnd.google-apps.drawing': ('application/pdf', '.pdf'),
}

s3 = boto3.client('s3')


def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    path = event.get('path', '')
    method = event.get('httpMethod', '')

    if path.endswith('/gdrive/auth-url') and method == 'GET':
        response = handle_auth_url(event)
    elif path.endswith('/gdrive/callback') and method == 'POST':
        response = handle_callback(event)
    elif path.endswith('/gdrive/files') and method == 'GET':
        response = handle_list_files(event)
    elif path.endswith('/gdrive/import') and method == 'POST':
        response = handle_import(event)
    else:
        response = {
            'statusCode': 404,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Not found'})
        }

    log_activity(event, response)
    return response


def _make_flow():
    """Create an OAuth2 flow from client config."""
    client_config = {
        'web': {
            'client_id': GOOGLE_CLIENT_ID,
            'client_secret': GOOGLE_CLIENT_SECRET,
            'auth_uri': 'https://accounts.google.com/o/oauth2/auth',
            'token_uri': 'https://oauth2.googleapis.com/token',
            'redirect_uris': [GOOGLE_REDIRECT_URI],
        }
    }
    flow = Flow.from_client_config(client_config, scopes=SCOPES)
    flow.redirect_uri = GOOGLE_REDIRECT_URI
    return flow


def _get_drive_service(refresh_token):
    """Build a Drive API service from a stored refresh token."""
    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri='https://oauth2.googleapis.com/token',
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        scopes=SCOPES
    )
    return build('drive', 'v3', credentials=creds)


def handle_auth_url(event):
    """GET /gdrive/auth-url - Returns the Google OAuth consent URL."""
    user, err = require_auth(event)
    if err:
        return err

    try:
        flow = _make_flow()
        auth_url, _ = flow.authorization_url(
            access_type='offline',
            prompt='consent',
            include_granted_scopes='true'
        )
        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'auth_url': auth_url})
        }
    except Exception as e:
        print(f"Auth URL error: {e}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Failed to generate auth URL'})
        }


def handle_callback(event):
    """POST /gdrive/callback - Exchange auth code for tokens, store refresh token."""
    user, err = require_auth(event)
    if err:
        return err

    try:
        body = json.loads(event.get('body', '{}'))
        code = body.get('code', '')

        if not code:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Authorization code is required'})
            }

        flow = _make_flow()
        flow.fetch_token(code=code)
        credentials = flow.credentials

        if not credentials.refresh_token:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'No refresh token received. Please revoke app access in Google and try again.'})
            }

        # Store refresh token in DB
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            """UPDATE users
               SET google_drive_refresh_token = %s,
                   google_drive_connected_at = %s
               WHERE id = %s""",
            (credentials.refresh_token, datetime.now(timezone.utc), user['user_id'])
        )
        conn.commit()
        cur.close()
        conn.close()

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'connected': True})
        }

    except Exception as e:
        print(f"Callback error: {e}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': f'Failed to exchange code: {str(e)}'})
        }


def handle_list_files(event):
    """GET /gdrive/files - List files in user's Google Drive."""
    user, err = require_auth(event)
    if err:
        return err

    try:
        # Get refresh token from DB
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT google_drive_refresh_token FROM users WHERE id = %s",
            (user['user_id'],)
        )
        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row or not row[0]:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Google Drive not connected'})
            }

        refresh_token = row[0]
        service = _get_drive_service(refresh_token)

        # Get folder_id from query params
        params = event.get('queryStringParameters') or {}
        folder_id = params.get('folder_id', 'root')

        query = f"'{folder_id}' in parents and trashed = false"
        results = service.files().list(
            q=query,
            pageSize=50,
            fields="files(id, name, mimeType, modifiedTime, size)",
            orderBy="folder,name"
        ).execute()

        files = results.get('files', [])

        # Separate folders and files, format response
        formatted = []
        for f in files:
            is_folder = f['mimeType'] == 'application/vnd.google-apps.folder'
            is_google_doc = f['mimeType'] in EXPORT_MIME_TYPES
            formatted.append({
                'id': f['id'],
                'name': f['name'],
                'mimeType': f['mimeType'],
                'modifiedTime': f.get('modifiedTime', ''),
                'size': int(f.get('size', 0)) if f.get('size') else None,
                'isFolder': is_folder,
                'isGoogleDoc': is_google_doc,
            })

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'files': formatted, 'folder_id': folder_id})
        }

    except Exception as e:
        print(f"List files error: {e}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': f'Failed to list files: {str(e)}'})
        }


def handle_import(event):
    """POST /gdrive/import - Download selected Drive files and upload to S3."""
    user, err = require_auth(event)
    if err:
        return err

    try:
        body = json.loads(event.get('body', '{}'))
        file_ids = body.get('file_ids', [])
        client_id = body.get('client_id', '')

        if not file_ids or not client_id:
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'file_ids and client_id are required'})
            }

        # PR 3.4b: share-aware access. account_admin in a recipient account
        # with a read_write share on this client can import Google Drive files
        # to it. Read-only share is sufficient for the SELECT here — the
        # write happens to S3 (the client's folder), not the clients row.
        conn = get_db_connection()
        cur = conn.cursor()
        frag, frag_params = clients_where_fragment(user, alias='c')
        cur.execute(
            f"SELECT c.s3_folder, c.encryption_key FROM clients c "
            f"WHERE c.id = %s AND ({frag})",
            (client_id,) + frag_params,
        )
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return {
                'statusCode': 403,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Client not found or not accessible'})
            }
        s3_folder = row[0]
        ck = unwrap_client_key(row[1]) if row[1] else None
        s3_enc = is_s3_encryption_enabled(cur)

        # Get refresh token
        cur.execute(
            "SELECT google_drive_refresh_token FROM users WHERE id = %s",
            (user['user_id'],)
        )
        token_row = cur.fetchone()
        if not token_row or not token_row[0]:
            cur.close()
            conn.close()
            return {
                'statusCode': 400,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Google Drive not connected'})
            }

        refresh_token = token_row[0]
        service = _get_drive_service(refresh_token)

        imported_files = []

        for file_id in file_ids:
            # Get file metadata
            file_meta = service.files().get(
                fileId=file_id,
                fields='id, name, mimeType, size'
            ).execute()

            file_name = file_meta['name']
            mime_type = file_meta['mimeType']

            # Handle Google Docs (export) vs regular files (download)
            if mime_type in EXPORT_MIME_TYPES:
                export_mime, ext = EXPORT_MIME_TYPES[mime_type]
                # Add extension if not already present
                if not file_name.lower().endswith(ext):
                    file_name = file_name + ext
                request = service.files().export_media(
                    fileId=file_id,
                    mimeType=export_mime
                )
                content_type = export_mime
            else:
                request = service.files().get_media(fileId=file_id)
                content_type = mime_type or 'application/octet-stream'

            # Download file content
            buffer = io.BytesIO()
            downloader = MediaIoBaseDownload(buffer, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()

            buffer.seek(0)

            # Upload to S3 (optionally encrypted with client key)
            s3_key = f"{s3_folder}/uploads/{file_name}"
            file_data = buffer.read()
            s3.put_object(
                Bucket=BUCKET_NAME,
                Key=s3_key,
                Body=maybe_encrypt_s3_bytes(ck, file_data, enabled=s3_enc),
                ContentType='application/octet-stream'
            )

            # Record in uploads table
            cur.execute(
                """INSERT INTO uploads (client_id, filename, file_type, s3_key, source)
                   VALUES (%s, %s, %s, %s, 'google_drive')
                   RETURNING id""",
                (client_id, file_name, content_type, s3_key)
            )
            upload_id = cur.fetchone()[0]

            imported_files.append({
                'id': str(upload_id),
                'name': file_name,
                'type': content_type,
                's3_key': s3_key,
                'source': 'google_drive'
            })

        conn.commit()
        cur.close()
        conn.close()

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({
                'imported': len(imported_files),
                'files': imported_files
            })
        }

    except Exception as e:
        print(f"Import error: {e}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': f'Failed to import files: {str(e)}'})
        }
