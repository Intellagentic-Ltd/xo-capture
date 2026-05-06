"""
XO Platform — dXO support Lambda

POST /api/dxo/synthesize  -- text-to-speech via AWS Polly. Returns MP3
                             bytes (base64-encoded for API Gateway). The
                             dXO overlay plays them via HTML5 <audio>.
                             Replaces browser TTS so demo narration sounds
                             like a London accent rather than a robot.

Voice catalogue (neural engine, eu-west-2):
- Brian   -- British male, London. Default.
- Amy     -- British female, London.
- Arthur  -- British male, deeper register.

Cost: ~$4 per 1M characters at the neural rate. A full dXO run is
~3,000 characters; ~5 cents per cold demo run. (S3 cache is intentionally
deferred from this v1 -- adds an IAM dependency + bucket. Add later if
re-run cost becomes meaningful.)

This endpoint is behind the same JWT auth as the rest of /api/*; the
overlay reads the operator's xo-token from localStorage when calling.

Ported from mfp/backend/dxo_endpoints.py (Flask Blueprint), adapted to
xo-capture's direct Lambda integration pattern.
"""

import base64
import json

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from auth_helper import require_auth, CORS_HEADERS, log_activity


_POLLY_REGION = "eu-west-2"
_POLLY_VOICES = {"Brian", "Amy", "Arthur"}
_MAX_CHARS = 3000  # generous upper bound for one narration line

_polly_client = None


def _polly():
    global _polly_client
    if _polly_client is None:
        _polly_client = boto3.client("polly", region_name=_POLLY_REGION)
    return _polly_client


def _binary_response(audio_bytes: bytes) -> dict:
    """Return MP3 bytes through API Gateway. Gateway needs `audio/mpeg`
    listed in its binary media types and Lambda proxy integration must
    use isBase64Encoded=True; the gateway then base64-decodes back to
    raw bytes before sending to the client."""
    headers = dict(CORS_HEADERS)
    headers["Content-Type"] = "audio/mpeg"
    headers["Cache-Control"] = "private, max-age=3600"
    return {
        "statusCode": 200,
        "headers": headers,
        "body": base64.b64encode(audio_bytes).decode("ascii"),
        "isBase64Encoded": True,
    }


def _json_error(status: int, message: str) -> dict:
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps({"error": message}),
    }


def lambda_handler(event, context):
    """Route to the synthesize handler. OPTIONS preflight returns CORS
    headers. POST is auth-gated and runs Polly."""

    method = event.get("httpMethod", "")

    # CORS preflight -- never auth-gated, returns the same CORS_HEADERS
    # used everywhere else in the platform.
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    user, err = require_auth(event)
    if err:
        log_activity(event, err)
        return err

    if method != "POST":
        response = {
            "statusCode": 405,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": "Method not allowed"}),
        }
        log_activity(event, response, user)
        return response

    # Path routing: this Lambda fronts the /api/dxo/* prefix. For now
    # we only handle /synthesize; /answer can be added here later.
    path = event.get("path", "") or event.get("resource", "") or ""
    if not path.endswith("/synthesize"):
        response = {
            "statusCode": 404,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": f"unknown dxo path: {path}"}),
        }
        log_activity(event, response, user)
        return response

    try:
        body = json.loads(event.get("body") or "{}")
    except (TypeError, ValueError):
        return _json_error(400, "invalid json body")

    text = (body.get("text") or "").strip()
    voice = body.get("voice") or "Brian"

    if not text:
        return _json_error(400, "text is required")
    if len(text) > _MAX_CHARS:
        return _json_error(400, f"text exceeds {_MAX_CHARS} chars")
    if voice not in _POLLY_VOICES:
        return _json_error(400, f"voice must be one of: {sorted(_POLLY_VOICES)}")

    try:
        resp = _polly().synthesize_speech(
            Text=text,
            VoiceId=voice,
            Engine="neural",
            OutputFormat="mp3",
        )
    except (BotoCoreError, ClientError) as poll_err:
        return _json_error(
            502,
            f"polly_synthesize_failed: {type(poll_err).__name__}: {poll_err}",
        )

    audio_bytes = resp["AudioStream"].read()
    response = _binary_response(audio_bytes)
    log_activity(event, response, user)
    return response
