#!/bin/bash
# Idempotent: create API Gateway resources + methods for the Salesforce surface,
# wire them to xo-salesforce-sync via AWS_PROXY, add CORS OPTIONS preflight,
# grant apigateway:InvokeFunction, and deploy to the prod stage.
#
# Mirrors backend/lambdas/hubspot-sync/setup-apigw.sh CORS pattern exactly.
# Safe to re-run: every resource/method is check-then-create.

set -euo pipefail

# ---- config ----
API_ID="odvopohlp3"
ROOT_ID="9ke7j5izxj"
REGION="eu-west-2"
PROFILE="intellagentic"
ACCOUNT_ID="290528720671"
LAMBDA_NAME="xo-salesforce-sync"
LAMBDA_URI="arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${LAMBDA_NAME}/invocations"
STAGE="prod"
PERM_STATEMENT_ID="apigw-invoke-xo-salesforce-sync"

AWS="aws --profile ${PROFILE} --region ${REGION} --no-cli-pager"

# Cache of full resource list so we can look up children without hammering the API.
RESOURCES_JSON=""

refresh_resources() {
  RESOURCES_JSON=$(${AWS} apigateway get-resources --rest-api-id "${API_ID}" --limit 500)
}

# get_or_create_resource <parent_id> <path_part>
# Echoes the resource ID of the child whose pathPart matches under parent_id.
# Creates it if missing. Refreshes cache after a create.
get_or_create_resource() {
  local parent_id="$1"
  local path_part="$2"

  local existing_id
  existing_id=$(echo "${RESOURCES_JSON}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
parent = '$parent_id'
part = '$path_part'
for item in data.get('items', []):
    if item.get('parentId') == parent and item.get('pathPart') == part:
        print(item['id'])
        break
")

  if [[ -n "${existing_id}" ]]; then
    echo "${existing_id}"
    return 0
  fi

  local new_id
  new_id=$(${AWS} apigateway create-resource \
    --rest-api-id "${API_ID}" \
    --parent-id "${parent_id}" \
    --path-part "${path_part}" \
    --query 'id' --output text)
  refresh_resources
  echo "${new_id}"
}

# wire_method <resource_id> <http_method>
# Idempotent: catches ConflictException on put-method (method already exists).
# Always (re)applies integration + responses so re-runs converge to the desired state.
wire_method() {
  local resource_id="$1"
  local method="$2"

  set +e
  ${AWS} apigateway put-method \
    --rest-api-id "${API_ID}" \
    --resource-id "${resource_id}" \
    --http-method "${method}" \
    --authorization-type NONE > /dev/null 2>&1
  local rc=$?
  set -e
  if [[ ${rc} -ne 0 ]]; then
    # Re-run path: method exists. That's fine; keep going.
    :
  fi

  ${AWS} apigateway put-integration \
    --rest-api-id "${API_ID}" \
    --resource-id "${resource_id}" \
    --http-method "${method}" \
    --type AWS_PROXY \
    --integration-http-method POST \
    --uri "${LAMBDA_URI}" \
    --content-handling CONVERT_TO_TEXT > /dev/null

  set +e
  ${AWS} apigateway put-method-response \
    --rest-api-id "${API_ID}" \
    --resource-id "${resource_id}" \
    --http-method "${method}" \
    --status-code 200 \
    --response-models '{"application/json":"Empty"}' > /dev/null 2>&1
  set -e

  set +e
  ${AWS} apigateway put-integration-response \
    --rest-api-id "${API_ID}" \
    --resource-id "${resource_id}" \
    --http-method "${method}" \
    --status-code 200 \
    --response-templates '{"application/json":""}' > /dev/null 2>&1
  set -e
}

# wire_options <resource_id>
# Adds the OPTIONS preflight: MOCK integration returning the standard CORS headers.
# Mirrors hubspot-sync/setup-apigw.sh exactly.
wire_options() {
  local resource_id="$1"

  set +e
  ${AWS} apigateway put-method \
    --rest-api-id "${API_ID}" \
    --resource-id "${resource_id}" \
    --http-method OPTIONS \
    --authorization-type NONE > /dev/null 2>&1
  set -e

  ${AWS} apigateway put-integration \
    --rest-api-id "${API_ID}" \
    --resource-id "${resource_id}" \
    --http-method OPTIONS \
    --type MOCK \
    --request-templates '{"application/json":"{\"statusCode\": 200}"}' > /dev/null

  set +e
  ${AWS} apigateway put-method-response \
    --rest-api-id "${API_ID}" \
    --resource-id "${resource_id}" \
    --http-method OPTIONS \
    --status-code 200 \
    --response-parameters '{"method.response.header.Access-Control-Allow-Credentials":false,"method.response.header.Access-Control-Allow-Headers":false,"method.response.header.Access-Control-Allow-Methods":false,"method.response.header.Access-Control-Allow-Origin":false}' \
    --response-models '{"application/json":"Empty"}' > /dev/null 2>&1
  set -e

  ${AWS} apigateway put-integration-response \
    --rest-api-id "${API_ID}" \
    --resource-id "${resource_id}" \
    --http-method OPTIONS \
    --status-code 200 \
    --response-parameters "{\"method.response.header.Access-Control-Allow-Credentials\":\"'true'\",\"method.response.header.Access-Control-Allow-Headers\":\"'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'\",\"method.response.header.Access-Control-Allow-Methods\":\"'DELETE,GET,OPTIONS,POST,PUT'\",\"method.response.header.Access-Control-Allow-Origin\":\"'*'\"}" > /dev/null
}

# wire_path <resource_id> <http_method> <pretty_path>
wire_path() {
  local resource_id="$1"
  local method="$2"
  local pretty="$3"
  echo "  → ${method} ${pretty} (resource ${resource_id})"
  wire_method "${resource_id}" "${method}"
  wire_options "${resource_id}"
}

# ---------------------------------------------------------------------------

echo "=== Refreshing resource list ==="
refresh_resources

echo ""
echo "=== Creating resource tree ==="

# /salesforce
SF_ID=$(get_or_create_resource "${ROOT_ID}" "salesforce")
echo "  /salesforce                                  = ${SF_ID}"

# /salesforce children
SF_CONNECT_ID=$(get_or_create_resource "${SF_ID}" "connect")
echo "  /salesforce/connect                          = ${SF_CONNECT_ID}"
SF_CALLBACK_ID=$(get_or_create_resource "${SF_ID}" "callback")
echo "  /salesforce/callback                         = ${SF_CALLBACK_ID}"
SF_STATUS_ID=$(get_or_create_resource "${SF_ID}" "status")
echo "  /salesforce/status                           = ${SF_STATUS_ID}"
SF_DISCONNECT_ID=$(get_or_create_resource "${SF_ID}" "disconnect")
echo "  /salesforce/disconnect                       = ${SF_DISCONNECT_ID}"

# /salesforce/sync + push/pull
SF_SYNC_ID=$(get_or_create_resource "${SF_ID}" "sync")
echo "  /salesforce/sync                             = ${SF_SYNC_ID}"
SF_SYNC_PUSH_ID=$(get_or_create_resource "${SF_SYNC_ID}" "push")
echo "  /salesforce/sync/push                        = ${SF_SYNC_PUSH_ID}"
SF_SYNC_PULL_ID=$(get_or_create_resource "${SF_SYNC_ID}" "pull")
echo "  /salesforce/sync/pull                        = ${SF_SYNC_PULL_ID}"

# /salesforce/conflicts + {log_id}/resolve
SF_CONFLICTS_ID=$(get_or_create_resource "${SF_ID}" "conflicts")
echo "  /salesforce/conflicts                        = ${SF_CONFLICTS_ID}"
SF_CONFLICTS_LOGID_ID=$(get_or_create_resource "${SF_CONFLICTS_ID}" "{log_id}")
echo "  /salesforce/conflicts/{log_id}               = ${SF_CONFLICTS_LOGID_ID}"
SF_CONFLICTS_RESOLVE_ID=$(get_or_create_resource "${SF_CONFLICTS_LOGID_ID}" "resolve")
echo "  /salesforce/conflicts/{log_id}/resolve       = ${SF_CONFLICTS_RESOLVE_ID}"

# /webhooks/salesforce/outbound-message
WH_ID=$(get_or_create_resource "${ROOT_ID}" "webhooks")
echo "  /webhooks                                    = ${WH_ID}"
WH_SF_ID=$(get_or_create_resource "${WH_ID}" "salesforce")
echo "  /webhooks/salesforce                         = ${WH_SF_ID}"
WH_SF_OB_ID=$(get_or_create_resource "${WH_SF_ID}" "outbound-message")
echo "  /webhooks/salesforce/outbound-message        = ${WH_SF_OB_ID}"

echo ""
echo "=== Wiring methods + OPTIONS preflight ==="

wire_path "${SF_CONNECT_ID}"           POST "/salesforce/connect"
wire_path "${SF_CALLBACK_ID}"          GET  "/salesforce/callback"
wire_path "${SF_STATUS_ID}"            GET  "/salesforce/status"
wire_path "${SF_DISCONNECT_ID}"        POST "/salesforce/disconnect"
wire_path "${SF_SYNC_PUSH_ID}"         POST "/salesforce/sync/push"
wire_path "${SF_SYNC_PULL_ID}"         POST "/salesforce/sync/pull"
wire_path "${SF_CONFLICTS_ID}"         GET  "/salesforce/conflicts"
wire_path "${SF_CONFLICTS_RESOLVE_ID}" POST "/salesforce/conflicts/{log_id}/resolve"
wire_path "${WH_SF_OB_ID}"             POST "/webhooks/salesforce/outbound-message"

echo ""
echo "=== Granting API Gateway invoke permission on ${LAMBDA_NAME} ==="
set +e
${AWS} lambda add-permission \
  --function-name "${LAMBDA_NAME}" \
  --statement-id "${PERM_STATEMENT_ID}" \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*/*" > /dev/null 2>&1
rc=$?
set -e
if [[ ${rc} -eq 0 ]]; then
  echo "  granted (statement-id ${PERM_STATEMENT_ID})"
else
  echo "  permission already exists (statement-id ${PERM_STATEMENT_ID}) — skipping"
fi

echo ""
echo "=== Deploying API to stage '${STAGE}' ==="
${AWS} apigateway create-deployment \
  --rest-api-id "${API_ID}" \
  --stage-name "${STAGE}" \
  --description "Add /salesforce/* and /webhooks/salesforce/* routes" > /dev/null
echo "  deployed."

echo ""
echo "=== Summary: wired paths ==="
cat <<EOF
  POST /salesforce/connect
  GET  /salesforce/callback
  GET  /salesforce/status
  POST /salesforce/disconnect
  POST /salesforce/sync/push
  POST /salesforce/sync/pull
  GET  /salesforce/conflicts
  POST /salesforce/conflicts/{log_id}/resolve
  POST /webhooks/salesforce/outbound-message
  (each with OPTIONS CORS preflight)
EOF
echo ""
echo "Done."
