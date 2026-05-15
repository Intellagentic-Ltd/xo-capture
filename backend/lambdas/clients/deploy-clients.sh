#!/bin/bash

# Deploy /clients Lambda (xo-clients).
#
# Pure-Python deploy. No native deps in this lambda — psycopg2 + bcrypt + jwt
# come from layers attached to the function (psycopg2-py311, bcrypt-jwt-layer).
# So we just package lambda_function.py + shared helpers and push.
#
# Do NOT use backend/deploy.sh — it bundles every lambda and is known-poisoned.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

FUNCTION_NAME="xo-clients"
REGION="eu-west-2"
PROFILE="intellagentic"

echo "Building /clients Lambda package..."

# Clean previous build
rm -rf package function.zip
mkdir -p package

# Copy Lambda function and shared helpers
cp lambda_function.py package/
cp ../shared/auth_helper.py package/
cp ../shared/crypto_helper.py package/
cp ../shared/client_access.py package/

# Zip
cd package
zip -q -r ../function.zip . -x "*.pyc" "__pycache__/*"
cd ..

echo "Package built: function.zip"
echo "   Size: $(du -h function.zip | cut -f1)"

echo ""
echo "Pushing to AWS Lambda ($FUNCTION_NAME, $REGION)..."
aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file fileb://function.zip \
  --region "$REGION" \
  --profile "$PROFILE" \
  --query '{LastModified:LastModified, CodeSha256:CodeSha256, CodeSize:CodeSize}' \
  --output table

echo "Deployed."
