#!/bin/bash

# Deploy /enrich Lambda with dependencies

set -e

echo "📦 Building /enrich Lambda package..."

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
cp preprocess_per_document.py package/
cp ../shared/auth_helper.py package/
cp ../shared/crypto_helper.py package/
cp ../shared/client_access.py package/

# Copy system skills
mkdir -p package/system-skills
cp ../../system-skills/*.md package/system-skills/

# Create zip
cd package
zip -r ../function.zip . -q
cd ..

echo "✅ Package built: function.zip"
echo "   Size: $(du -h function.zip | cut -f1)"
