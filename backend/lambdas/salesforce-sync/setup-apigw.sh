#!/bin/bash
# Wire /salesforce/* routes on the existing xo-api REST API.
# Mirrors backend/lambdas/hubspot-sync/setup-apigw.sh.
#
# Prereq (one-time, manual or via aws apigateway create-resource):
#   Create the /salesforce, /salesforce/connect, /salesforce/callback,
#   /salesforce/status, /salesforce/disconnect, /salesforce/sync,
#   /salesforce/sync/push resources under the existing API.
#
# Then populate the RES_ID values below from `aws apigateway get-resources`
# and run this script.
set -e

P="--profile intellagentic --region eu-west-2"
API="odvopohlp3"
URI="arn:aws:apigateway:eu-west-2:lambda:path/2015-03-31/functions/arn:aws:lambda:eu-west-2:290528720671:function:xo-salesforce-sync/invocations"

# Resource ID -> Path -> HTTP Method
# Populate RES_IDs after creating the resources in API Gateway.
# Example (replace XXXXXX with the actual IDs):
#   "XXXXXX:POST:/salesforce/connect"
#   "XXXXXX:GET:/salesforce/callback"
#   "XXXXXX:GET:/salesforce/status"
#   "XXXXXX:POST:/salesforce/disconnect"
#   "XXXXXX:POST:/salesforce/sync/push"
ROUTES=(
  # PR 2 routes:
  # "RES_ID:POST:/salesforce/connect"
  # "RES_ID:GET:/salesforce/callback"
  # "RES_ID:GET:/salesforce/status"
  # "RES_ID:POST:/salesforce/disconnect"
  # "RES_ID:POST:/salesforce/sync/push"
  #
  # PR 3 routes:
  # "RES_ID:POST:/salesforce/sync/pull"
  # "RES_ID:POST:/webhooks/salesforce/outbound-message"
)

if [ ${#ROUTES[@]} -eq 0 ]; then
  echo "ROUTES array is empty. Populate it with the resource IDs and re-run."
  echo "Hint: aws apigateway get-resources $P --rest-api-id $API --query 'items[?starts_with(path, \`/salesforce\`)].[id,path]' --output table"
  exit 1
fi

for route in "${ROUTES[@]}"; do
  IFS=':' read -r RES_ID METHOD PATHNAME <<< "$route"

  echo "=== $METHOD $PATHNAME ($RES_ID) ==="

  # Main method
  aws apigateway put-method $P --rest-api-id $API --resource-id $RES_ID --http-method $METHOD --authorization-type NONE --no-cli-pager > /dev/null
  echo "  put-method $METHOD"

  aws apigateway put-integration $P --rest-api-id $API --resource-id $RES_ID --http-method $METHOD --type AWS_PROXY --integration-http-method POST --uri "$URI" --content-handling CONVERT_TO_TEXT --no-cli-pager > /dev/null
  echo "  put-integration $METHOD -> Lambda"

  aws apigateway put-method-response $P --rest-api-id $API --resource-id $RES_ID --http-method $METHOD --status-code 200 --response-models '{"application/json":"Empty"}' --no-cli-pager > /dev/null
  echo "  put-method-response 200"

  aws apigateway put-integration-response $P --rest-api-id $API --resource-id $RES_ID --http-method $METHOD --status-code 200 --response-templates '{"application/json":""}' --no-cli-pager > /dev/null
  echo "  put-integration-response 200"

  # OPTIONS (CORS)
  aws apigateway put-method $P --rest-api-id $API --resource-id $RES_ID --http-method OPTIONS --authorization-type NONE --no-cli-pager > /dev/null
  echo "  put-method OPTIONS"

  aws apigateway put-integration $P --rest-api-id $API --resource-id $RES_ID --http-method OPTIONS --type MOCK --request-templates '{"application/json":"{\"statusCode\": 200}"}' --no-cli-pager > /dev/null
  echo "  put-integration OPTIONS (MOCK)"

  aws apigateway put-method-response $P --rest-api-id $API --resource-id $RES_ID --http-method OPTIONS --status-code 200 \
    --response-parameters '{"method.response.header.Access-Control-Allow-Credentials":false,"method.response.header.Access-Control-Allow-Headers":false,"method.response.header.Access-Control-Allow-Methods":false,"method.response.header.Access-Control-Allow-Origin":false}' \
    --response-models '{"application/json":"Empty"}' --no-cli-pager > /dev/null
  echo "  put-method-response OPTIONS 200"

  aws apigateway put-integration-response $P --rest-api-id $API --resource-id $RES_ID --http-method OPTIONS --status-code 200 \
    --response-parameters "{\"method.response.header.Access-Control-Allow-Credentials\":\"'true'\",\"method.response.header.Access-Control-Allow-Headers\":\"'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'\",\"method.response.header.Access-Control-Allow-Methods\":\"'DELETE,GET,OPTIONS,POST,PUT'\",\"method.response.header.Access-Control-Allow-Origin\":\"'*'\"}" \
    --no-cli-pager > /dev/null
  echo "  put-integration-response OPTIONS CORS"

  echo ""
done

echo "All Salesforce routes wired."
