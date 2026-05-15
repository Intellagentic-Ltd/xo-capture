#!/bin/bash

# Deploy /results Lambda with Linux-compatible dependencies.
#
# Builds a fresh zip with manylinux2014_x86_64 wheels (cryptography has
# native deps — a plain pip install from macOS would ship the wrong wheel
# and the lambda would 500 at runtime trying to unwrap encrypted client keys).
# Then pushes via aws lambda update-function-code.
#
# Mirrors backend/lambdas/enrich/deploy-enrich.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

FUNCTION_NAME="xo-results"
REGION="eu-west-2"
PROFILE="intellagentic"

echo "📦 Building /results Lambda package..."

# Clean previous build
rm -rf package function.zip

# Install runtime deps targeting Lambda runtime (Python 3.11, Amazon Linux x86_64).
# boto3/botocore ship with the Lambda runtime — do NOT vendor them.
pip3 install -r requirements.txt -t package/ --quiet \
  --platform manylinux2014_x86_64 \
  --implementation cp \
  --python-version 3.11 \
  --only-binary=:all: \
  --upgrade

# Copy Lambda function and shared helpers
cp lambda_function.py package/
cp ../shared/auth_helper.py package/
cp ../shared/crypto_helper.py package/
cp ../shared/client_access.py package/

# Sanity check: the cryptography wheel must be a manylinux build, not macosx_*.
CRYPTO_DIST=$(find package -maxdepth 2 -type d -name "cryptography-*.dist-info" | head -1)
if [ -z "$CRYPTO_DIST" ]; then
  echo "❌ cryptography not installed into package/ — aborting"
  exit 1
fi
if grep -qi "macosx" "$CRYPTO_DIST/WHEEL" 2>/dev/null; then
  echo "❌ cryptography wheel is macosx, not manylinux — aborting"
  cat "$CRYPTO_DIST/WHEEL"
  exit 1
fi
echo "✓ cryptography wheel tag:"
grep -i "^Tag:" "$CRYPTO_DIST/WHEEL" || true

# Create zip
cd package
zip -r ../function.zip . -q -x "*.pyc" "__pycache__/*"
cd ..

echo "✅ Package built: function.zip"
echo "   Size: $(du -h function.zip | cut -f1)"

echo ""
echo "🚀 Pushing to AWS Lambda ($FUNCTION_NAME, $REGION)..."
aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file fileb://function.zip \
  --region "$REGION" \
  --profile "$PROFILE" \
  --query '{LastModified:LastModified, CodeSha256:CodeSha256, CodeSize:CodeSize}' \
  --output table

echo "✅ Deployed."
