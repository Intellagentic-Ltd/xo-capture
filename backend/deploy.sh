#!/bin/bash

# XO Platform - Quick Deploy Script
# Deploys Lambda functions to AWS
# All Lambdas now require auth_helper.py and the xo-psycopg2 layer

set -e

REGION="eu-west-2"
BUCKET_NAME="xo-client-data-mv"
LAYER_NAME="psycopg2-py311"

echo "🚀 XO Platform - Lambda Deployment"
echo "=================================="

# Get AWS Account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "AWS Account: $ACCOUNT_ID"
echo "Region: $REGION"
echo ""

# Get latest layer ARN
LAYER_ARN=$(aws lambda list-layer-versions --layer-name $LAYER_NAME --region $REGION --query 'LayerVersions[0].LayerVersionArn' --output text 2>/dev/null || echo "")
if [ "$LAYER_ARN" = "None" ] || [ -z "$LAYER_ARN" ]; then
    echo "⚠️  WARNING: Lambda layer '$LAYER_NAME' not found. Build it first."
    echo "   See backend/README.md for layer build instructions."
    LAYER_ARN=""
fi

LAYERS="arn:aws:lambda:eu-west-2:290528720671:layer:bcrypt-jwt-layer:1 \
        arn:aws:lambda:eu-west-2:290528720671:layer:psycopg2-py311:1"
echo $LAYERS
# Helper function to deploy a Lambda
deploy_lambda() {
    local FUNC_NAME=$1
    local FUNC_DIR=$2
    local TIMEOUT=${3:-30}
    local MEMORY=${4:-256}

    echo "📦 Deploying $FUNC_NAME Lambda..."
    cd lambdas/$FUNC_DIR

    # Copy shared helpers into package
    cp ../shared/auth_helper.py .
    cp ../shared/crypto_helper.py .

    zip -q -r function.zip lambda_function.py auth_helper.py crypto_helper.py

    if aws lambda get-function --function-name $FUNC_NAME --region $REGION 2>/dev/null; then
        echo "   Updating existing function..."
        aws lambda update-function-code \
            --function-name $FUNC_NAME \
            --zip-file fileb://function.zip \
            --region $REGION \
            --output text > /dev/null

        # Attach layer if available
        if [ -n "$LAYER_ARN" ]; then
            aws lambda update-function-configuration \
                --function-name $FUNC_NAME \
                --layers $LAYERS \
                --region $REGION \
                --output text > /dev/null 2>/dev/null || true
        fi
    else
        echo "   Creating new function..."
        local LAYER_FLAG=""
        if [ -n "$LAYER_ARN" ]; then
            LAYER_FLAG="--layers $LAYERS"
        fi
        aws lambda create-function \
            --function-name $FUNC_NAME \
            --runtime python3.11 \
            --role arn:aws:iam::${ACCOUNT_ID}:role/xo-lambda-role \
            --handler lambda_function.lambda_handler \
            --zip-file fileb://function.zip \
            --timeout $TIMEOUT \
            --memory-size $MEMORY \
            --environment Variables="{BUCKET_NAME=$BUCKET_NAME}" \
            $LAYER_FLAG \
            --region $REGION \
            --output text > /dev/null
    fi

    # Clean up
    rm -f function.zip auth_helper.py crypto_helper.py
    cd ../..
    echo "   ✅ $FUNC_NAME deployed"
}

# Deploy all Lambdas
deploy_lambda "xo-clients" "clients"
deploy_lambda "xo-upload" "upload"
deploy_lambda "xo-results" "results"
deploy_lambda "xo-auth" "auth"
deploy_lambda "xo-buttons" "buttons"
deploy_lambda "xo-enrich" "enrich"
deploy_lambda "xo-gdrive-import" "gdrive"
deploy_lambda "xo-rapid-prototype" "rapid-prototype"
deploy_lambda "xo-dxo" "dxo"

echo ""
echo "✨ Simple Lambda deployment complete!"
echo ""
echo "Note: xo-enrich, xo-results, and xo-gdrive-import have their own deploy scripts"
echo "  - cd lambdas/enrich && ./deploy-enrich.sh"
echo "  - cd lambdas/gdrive && ./deploy-gdrive.sh"
echo ""
echo "Next steps:"
echo "1. Run ./set-db-config.sh to set DATABASE_URL and JWT_SECRET on all Lambdas"
echo "2. Update API Gateway routes (add /auth/login, /buttons, /buttons/sync)"
echo "3. Test with: curl -X POST <API_BASE>/auth/login -d '{\"email\":\"ken.scott@intellagentic.io\",\"password\":\"...\"}'"
