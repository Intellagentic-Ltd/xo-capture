#!/bin/bash

# Deploy /clients Lambda.
# Mirrors backend/lambdas/salesforce-sync/deploy-salesforce.sh shape.
# No pip deps — boto3 and psycopg2 come from the Lambda runtime/layer.

set -e

echo "Building /clients Lambda package..."

rm -rf package function.zip
mkdir -p package

# Local source + local helpers (auth_helper, crypto_helper, client_access
# all live alongside lambda_function.py for this lambda).
cp lambda_function.py package/
cp auth_helper.py package/
cp crypto_helper.py package/
cp ../shared/client_access.py package/

cd package
zip -r ../function.zip . -q
cd ..

echo "Package built: function.zip"
echo "   Size: $(du -h function.zip | cut -f1)"

echo "Deploying to AWS Lambda: xo-clients (eu-west-2)..."
aws lambda update-function-code \
  --function-name xo-clients \
  --zip-file fileb://function.zip \
  --region eu-west-2 \
  --profile intellagentic

echo "Deploy complete: xo-clients"
