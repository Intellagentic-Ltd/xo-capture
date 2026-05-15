#!/bin/bash

# Deploy /hubspot-sync Lambda with dependencies

set -e

echo "Building /hubspot-sync Lambda package..."

# Clean previous build
rm -rf package function.zip

# Install dependencies targeting Lambda runtime (Python 3.11, Amazon Linux x86_64)
pip3 install -r requirements.txt -t package/ --quiet \
  --platform manylinux2014_x86_64 \
  --implementation cp \
  --python-version 3.11 \
  --only-binary=:all:

# Copy Lambda function and shared helpers
cp lambda_function.py package/
cp ../shared/auth_helper.py package/
cp ../shared/crypto_helper.py package/
cp ../shared/client_access.py package/

# Create zip
cd package
zip -r ../function.zip . -q
cd ..

echo "Package built: function.zip"
echo "   Size: $(du -h function.zip | cut -f1)"

# Deploy to AWS Lambda (eu-west-2)
echo "Deploying to AWS Lambda: xo-hubspot-sync (eu-west-2)..."
aws lambda update-function-code \
  --function-name xo-hubspot-sync \
  --zip-file fileb://function.zip \
  --region eu-west-2

echo "Deploy complete: xo-hubspot-sync"
