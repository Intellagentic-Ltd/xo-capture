#!/bin/bash

# Deploy /salesforce-sync Lambda with dependencies.
# Mirrors backend/lambdas/hubspot-sync/deploy-hubspot.sh.

set -e

echo "Building /salesforce-sync Lambda package..."

# Clean previous build
rm -rf package function.zip

# Install dependencies targeting Lambda runtime (Python 3.11, Amazon Linux x86_64)
pip3 install -r requirements.txt -t package/ --quiet \
  --platform manylinux2014_x86_64 \
  --implementation cp \
  --python-version 3.11 \
  --only-binary=:all:

# Copy Lambda function, SF-local modules, and shared helpers.
# SF-local: sf_client (HTTP/token), sf_pull (pull path), sf_webhook (Outbound Message).
# Shared:   auth_helper, crypto_helper, integrations_config.
cp lambda_function.py package/
cp sf_client.py package/
cp sf_pull.py package/
cp sf_webhook.py package/
cp ../shared/auth_helper.py package/
cp ../shared/crypto_helper.py package/
cp ../shared/integrations_config.py package/

# Create zip
cd package
zip -r ../function.zip . -q
cd ..

echo "Package built: function.zip"
echo "   Size: $(du -h function.zip | cut -f1)"

# Deploy to AWS Lambda (eu-west-2)
echo "Deploying to AWS Lambda: xo-salesforce-sync (eu-west-2)..."
aws lambda update-function-code \
  --function-name xo-salesforce-sync \
  --zip-file fileb://function.zip \
  --region eu-west-2

echo "Deploy complete: xo-salesforce-sync"
