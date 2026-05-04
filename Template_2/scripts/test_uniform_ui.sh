#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${1:-${TEMPLATE_DIR}/.env}"
COMPOSE_FILE="${TEMPLATE_DIR}/docker-compose.yml"
APP_URL="${APP_URL:-http://localhost:8080}"
N8N_URL="${N8N_URL:-http://localhost:5678}"
PDF_PATH="${PDF_PATH:-}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

wait_for_app_health() {
  local retries=60
  local delay=2
  local attempt=1

  while (( attempt <= retries )); do
    if curl -fsS "${APP_URL}/health" >/tmp/template2_health.json 2>/dev/null; then
      cat /tmp/template2_health.json
      return 0
    fi
    sleep "$delay"
    attempt=$((attempt + 1))
  done

  echo "App health check timed out: ${APP_URL}/health" >&2
  return 1
}

wait_for_run_webhook() {
  local token="$1"
  local retries=30
  local delay=2
  local attempt=1

  while (( attempt <= retries )); do
    local code
    code="$(curl -sS -o /tmp/template2_run_probe.json -w '%{http_code}' \
      -X POST "${N8N_URL}/webhook/summaries/run" \
      -H 'Content-Type: application/json' \
      -H "x-internal-token: ${token}" \
      -d '{"executionMode":"sync","jobId":"probe","batchStrategy":"count_only"}')"

    if [[ "$code" == "200" ]]; then
      echo "$code"
      return 0
    fi

    if [[ "$code" != "404" ]]; then
      echo "$code"
      return 1
    fi

    sleep "$delay"
    attempt=$((attempt + 1))
  done

  echo "404"
  return 1
}

require_cmd docker
require_cmd curl
require_cmd jq
require_cmd awk

if [[ ! -f "$ENV_FILE" ]]; then
  cat >&2 <<EOF_ERR
Missing env file: $ENV_FILE
Create it first:
  cp ${TEMPLATE_DIR}/.env.example ${TEMPLATE_DIR}/.env
EOF_ERR
  exit 1
fi

echo "[1/7] Using env file ${ENV_FILE}"

echo "[2/7] Recreating app and n8n services"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --force-recreate app n8n

echo "[3/7] Waiting for app health"
HEALTH_JSON="$(wait_for_app_health)"

echo "[4/7] Health snapshot"
echo "$HEALTH_JSON" | jq '{ok, service, executionPolicy, n8n}'

echo "[5/7] n8n reachability"
N8N_CODE="$(curl -sS -o /dev/null -w '%{http_code}' "$N8N_URL/")"
echo "n8n_http_code=${N8N_CODE}"

echo "[6/7] Checking wf_template2_unified presence in n8n"
WF_LIST="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T n8n n8n list:workflow 2>/dev/null || true)"
if ! echo "$WF_LIST" | grep -qE '\|wf_template2_unified$'; then
  cat >&2 <<EOF_MISSING
wf_template2_unified is not present in n8n.
Import and activate this workflow in n8n UI, then rerun this script:
  ${TEMPLATE_DIR}/examples/pdf_batch_summary/workflows/wf_template2_unified.json
EOF_MISSING
  exit 2
fi

echo "[7/7] Run webhook probe with readiness wait"
TOKEN="$(awk -F= '/^INTERNAL_API_TOKEN=/{print substr($0,index($0,"=")+1)}' "$ENV_FILE" | tail -n 1)"
if [[ -z "$TOKEN" ]]; then
  echo "INTERNAL_API_TOKEN missing in env file; cannot probe run webhook." >&2
  exit 1
fi

RUN_CODE="$(wait_for_run_webhook "$TOKEN" || true)"
echo "run_webhook_code=${RUN_CODE}"
if [[ "$RUN_CODE" != "200" ]]; then
  cat /tmp/template2_run_probe.json 2>/dev/null || true
  cat >&2 <<EOF_FAIL
Run webhook is not ready.
Open n8n UI (${N8N_URL}) and confirm wf_template2_unified is active.
EOF_FAIL
  exit 1
fi

echo
echo "Setup complete."
echo "UI test steps:"
echo "1. Open ${APP_URL}"
echo "2. Register a new user and log in"
echo "3. Upload a PDF"
echo "4. Choose profile: pdf_batch_summary"
echo "5. Choose Execution Mode: sync"
echo "6. Click Run and watch status move: processing -> completed/failed"
echo "7. Open Job Details and confirm summary + token usage + cost fields"

if [[ -n "$PDF_PATH" ]]; then
  if [[ -f "$PDF_PATH" ]]; then
    echo "Suggested PDF for upload: ${PDF_PATH}"
  else
    echo "PDF_PATH is set but file not found: ${PDF_PATH}"
  fi
fi
