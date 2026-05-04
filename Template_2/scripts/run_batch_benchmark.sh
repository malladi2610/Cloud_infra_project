#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

APP_URL="${APP_URL:-http://localhost:8080}"
EMAIL="${EMAIL:-}"
PASSWORD="${PASSWORD:-}"
PROFILE_ID="${PROFILE_ID:-pdf_batch_summary}"
RUNS="${RUNS:-8}"
DOCUMENT_ID="${DOCUMENT_ID:-}"
PDF_PATH="${PDF_PATH:-}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-20}"
TIMEOUT_SEC="${TIMEOUT_SEC:-7200}"
OUTPUT_JSON="${OUTPUT_JSON:-}"

usage() {
  cat <<'EOF'
Usage:
  run_batch_benchmark.sh --email <email> --password <password> [options]

Required:
  --email <email>
  --password <password>

Document input (choose one):
  --document-id <uuid>          Use an existing uploaded document
  --pdf-path <path/to/file.pdf> Upload PDF first, then benchmark with that document

Options:
  --app-url <url>               Default: http://localhost:8080
  --profile-id <id>             Default: pdf_batch_summary
  --runs <n>                    Number of batch jobs to submit (default: 8)
  --poll-interval-sec <n>       Poll interval in seconds (default: 20)
  --timeout-sec <n>             Max total wait in seconds (default: 7200)
  --output-json <path>          Write final benchmark JSON to a file
  --help                        Show this help

Examples:
  run_batch_benchmark.sh \
    --email admin@template2.local \
    --password admin \
    --document-id 11111111-2222-3333-4444-555555555555 \
    --runs 8

  run_batch_benchmark.sh \
    --email admin@template2.local \
    --password admin \
    --pdf-path /abs/path/benchmark_8_pages_simple.pdf \
    --runs 8 \
    --output-json /tmp/batch_benchmark.json
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

json_request() {
  local method="$1"
  local path="$2"
  local payload="${3:-}"
  local response
  local body
  local status

  if [[ -n "$payload" ]]; then
    response="$(curl -sS -X "$method" "${APP_URL}${path}" \
      -H "Content-Type: application/json" \
      -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
      --data "$payload" \
      -w $'\n%{http_code}')"
  else
    response="$(curl -sS -X "$method" "${APP_URL}${path}" \
      -H "Content-Type: application/json" \
      -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
      -w $'\n%{http_code}')"
  fi

  status="${response##*$'\n'}"
  body="${response%$'\n'*}"

  if [[ "$status" =~ ^2[0-9][0-9]$ ]]; then
    printf '%s' "$body"
    return 0
  fi

  echo "Request failed: ${method} ${path} -> HTTP ${status}" >&2
  echo "$body" >&2
  return 1
}

upload_pdf() {
  local file_path="$1"
  local response
  local body
  local status

  response="$(curl -sS -X POST "${APP_URL}/api/documents/upload" \
    -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -F "file=@${file_path};type=application/pdf" \
    -w $'\n%{http_code}')"

  status="${response##*$'\n'}"
  body="${response%$'\n'*}"

  if [[ "$status" =~ ^2[0-9][0-9]$ ]]; then
    printf '%s' "$body"
    return 0
  fi

  echo "Upload failed: ${file_path} -> HTTP ${status}" >&2
  echo "$body" >&2
  return 1
}

is_uuid() {
  [[ "$1" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-url)
      APP_URL="$2"
      shift 2
      ;;
    --email)
      EMAIL="$2"
      shift 2
      ;;
    --password)
      PASSWORD="$2"
      shift 2
      ;;
    --profile-id)
      PROFILE_ID="$2"
      shift 2
      ;;
    --runs)
      RUNS="$2"
      shift 2
      ;;
    --document-id)
      DOCUMENT_ID="$2"
      shift 2
      ;;
    --pdf-path)
      PDF_PATH="$2"
      shift 2
      ;;
    --poll-interval-sec)
      POLL_INTERVAL_SEC="$2"
      shift 2
      ;;
    --timeout-sec)
      TIMEOUT_SEC="$2"
      shift 2
      ;;
    --output-json)
      OUTPUT_JSON="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_cmd curl
require_cmd jq

if [[ -z "$EMAIL" || -z "$PASSWORD" ]]; then
  echo "--email and --password are required." >&2
  usage
  exit 1
fi

if [[ -z "$DOCUMENT_ID" && -z "$PDF_PATH" ]]; then
  echo "Provide either --document-id or --pdf-path." >&2
  usage
  exit 1
fi

if [[ -n "$DOCUMENT_ID" && -n "$PDF_PATH" ]]; then
  echo "Use only one: --document-id or --pdf-path." >&2
  usage
  exit 1
fi

if ! [[ "$RUNS" =~ ^[0-9]+$ ]] || [[ "$RUNS" -lt 1 ]]; then
  echo "--runs must be a positive integer." >&2
  exit 1
fi

if ! [[ "$POLL_INTERVAL_SEC" =~ ^[0-9]+$ ]] || [[ "$POLL_INTERVAL_SEC" -lt 1 ]]; then
  echo "--poll-interval-sec must be a positive integer." >&2
  exit 1
fi

if ! [[ "$TIMEOUT_SEC" =~ ^[0-9]+$ ]] || [[ "$TIMEOUT_SEC" -lt 1 ]]; then
  echo "--timeout-sec must be a positive integer." >&2
  exit 1
fi

if [[ -n "$PDF_PATH" && ! -f "$PDF_PATH" ]]; then
  echo "PDF file not found: $PDF_PATH" >&2
  exit 1
fi

if [[ -n "$DOCUMENT_ID" ]] && ! is_uuid "$DOCUMENT_ID"; then
  echo "Invalid --document-id UUID: $DOCUMENT_ID" >&2
  exit 1
fi

COOKIE_JAR="$(mktemp)"
JOB_IDS_FILE="$(mktemp)"
JOB_FINAL_FILE="$(mktemp)"
DONE_IDS_FILE="$(mktemp)"
trap 'rm -f "$COOKIE_JAR" "$JOB_IDS_FILE" "$JOB_FINAL_FILE" "$DONE_IDS_FILE"' EXIT

echo "[1/6] Login"
login_payload="$(jq -nc --arg email "$EMAIL" --arg password "$PASSWORD" '{email:$email,password:$password}')"
json_request "POST" "/api/auth/login" "$login_payload" >/dev/null

if [[ -n "$PDF_PATH" ]]; then
  echo "[2/6] Upload document: $PDF_PATH"
  upload_response="$(upload_pdf "$PDF_PATH")"
  DOCUMENT_ID="$(echo "$upload_response" | jq -r '.document.id // empty')"
  if [[ -z "$DOCUMENT_ID" ]]; then
    echo "Upload succeeded but no document id returned." >&2
    echo "$upload_response" >&2
    exit 1
  fi
else
  echo "[2/6] Use existing document: $DOCUMENT_ID"
fi

echo "[3/6] Submit ${RUNS} batch jobs"
for i in $(seq 1 "$RUNS"); do
  run_payload="$(jq -nc \
    --arg profileId "$PROFILE_ID" \
    --arg documentId "$DOCUMENT_ID" \
    '{profileId:$profileId, documentId:$documentId, executionMode:"batch", batchStrategy:"count_only"}')"
  run_response="$(json_request "POST" "/api/summaries/run" "$run_payload")"
  job_id="$(echo "$run_response" | jq -r '.job.id // empty')"
  if [[ -z "$job_id" ]]; then
    echo "Failed to parse job id from run response." >&2
    echo "$run_response" >&2
    exit 1
  fi
  echo "$job_id" >>"$JOB_IDS_FILE"
  echo "  submitted [$i/$RUNS] job_id=$job_id"
done

echo "[4/6] Poll until terminal status"
start_ts="$(date +%s)"
terminal_count=0

job_ids=()
while IFS= read -r line; do
  [[ -n "$line" ]] && job_ids+=("$line")
done <"$JOB_IDS_FILE"

while [[ "$terminal_count" -lt "${#job_ids[@]}" ]]; do
  now_ts="$(date +%s)"
  elapsed=$((now_ts - start_ts))
  if [[ "$elapsed" -ge "$TIMEOUT_SEC" ]]; then
    echo "Polling timed out after ${TIMEOUT_SEC}s." >&2
    break
  fi

  for job_id in "${job_ids[@]}"; do
    if grep -Fxq "$job_id" "$DONE_IDS_FILE"; then
      continue
    fi

    detail_response="$(json_request "GET" "/api/summaries/jobs/${job_id}")"
    status="$(echo "$detail_response" | jq -r '.job.status // "unknown"')"
    if [[ "$status" == "completed" || "$status" == "failed" || "$status" == "expired" ]]; then
      echo "$job_id" >>"$DONE_IDS_FILE"
      terminal_count=$((terminal_count + 1))
      batch_id="$(echo "$detail_response" | jq -r '.job.batch_id // empty')"
      openai_batch_id="$(echo "$detail_response" | jq -r '.job.openai_batch_id // empty')"
      if [[ -n "$batch_id" || -n "$openai_batch_id" ]]; then
        echo "  terminal [$terminal_count/${#job_ids[@]}] job_id=$job_id status=$status batch_id=${batch_id:-n/a} openai_batch_id=${openai_batch_id:-n/a}"
      else
        echo "  terminal [$terminal_count/${#job_ids[@]}] job_id=$job_id status=$status"
      fi
    fi
  done

  if [[ "$terminal_count" -lt "${#job_ids[@]}" ]]; then
    sleep "$POLL_INTERVAL_SEC"
  fi
done

echo "[5/6] Collect final job details"
for job_id in "${job_ids[@]}"; do
  detail_response="$(json_request "GET" "/api/summaries/jobs/${job_id}")"
  echo "$detail_response" | jq -c '{job: .job, batch: .batch}' >>"$JOB_FINAL_FILE"
done

echo "[6/6] Build benchmark summary"
summary_json="$(
  jq -s --arg app_url "$APP_URL" --arg profile_id "$PROFILE_ID" --arg document_id "$DOCUMENT_ID" '
    def p95(values):
      if (values | length) == 0 then 0
      else
        (values | sort) as $s
        | (($s | length) * 0.95 | ceil | . - 1) as $idx
        | $s[$idx]
      end;

    def parse_epoch($ts):
      if ($ts == null or $ts == "") then null
      else (
        try ($ts | fromdateiso8601)
        catch (
          try ($ts | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601)
          catch null
        )
      )
      end;

    def ms_between($start; $end):
      (parse_epoch($start)) as $s
      | (parse_epoch($end)) as $e
      | if ($s == null or $e == null) then 0 else ((($e - $s) * 1000) | floor) end;

    . as $rows
    | ($rows | map(.job)) as $jobs
    | ($jobs | map(select(.status == "completed"))) as $completed
    | ($jobs | map(select(.status == "failed"))) as $failed
    | ($jobs | map(select(.status == "expired"))) as $expired
    | ($completed | map((.input_tokens // 0) | tonumber) | add // 0) as $input_sum
    | ($completed | map((.output_tokens // 0) | tonumber) | add // 0) as $output_sum
    | ($completed | map((.total_tokens // 0) | tonumber) | add // 0) as $total_sum
    | ($completed | map((.cost_est_usd // 0) | tonumber) | add // 0) as $cost_sum
    | ($completed | map((.latency_ms // 0) | tonumber)) as $latencies
    | ($completed | map(ms_between(.created_at; .completed_at))) as $e2e_latencies
    | ($jobs | map(.batch_id // empty) | map(select(length > 0)) | unique) as $batch_ids
    | ($jobs | map(.openai_batch_id // empty) | map(select(length > 0)) | unique) as $openai_batch_ids
    | {
        mode: "batch",
        appUrl: $app_url,
        profileId: $profile_id,
        documentId: $document_id,
        jobsSubmitted: ($jobs | length),
        jobsCompleted: ($completed | length),
        jobsFailed: ($failed | length),
        jobsExpired: ($expired | length),
        successRatePct: (if ($jobs | length) == 0 then 0 else ((($completed | length) * 100.0) / ($jobs | length)) end),
        totals: {
          inputTokens: $input_sum,
          outputTokens: $output_sum,
          totalTokens: $total_sum,
          costUsd: ($cost_sum | tonumber)
        },
        batchWindowStats: {
          localBatchWindowCount: ($batch_ids | length),
          openAIBatchCount: ($openai_batch_ids | length),
          localBatchIds: $batch_ids,
          openAIBatchIds: $openai_batch_ids
        },
        averagesCompleted: {
          tokensPerJob: (if ($completed | length) == 0 then 0 else ($total_sum / ($completed | length)) end),
          costUsdPerJob: (if ($completed | length) == 0 then 0 else ($cost_sum / ($completed | length)) end),
          modelLatencyMs: (if ($latencies | length) == 0 then 0 else (($latencies | add) / ($latencies | length)) end),
          p95ModelLatencyMs: (p95($latencies)),
          endToEndLatencyMs: (if ($e2e_latencies | length) == 0 then 0 else (($e2e_latencies | add) / ($e2e_latencies | length)) end),
          p95EndToEndLatencyMs: (p95($e2e_latencies))
        },
        jobs: $rows
      }
  ' "$JOB_FINAL_FILE"
)"

if [[ -n "$OUTPUT_JSON" ]]; then
  mkdir -p "$(dirname "$OUTPUT_JSON")"
  printf '%s\n' "$summary_json" >"$OUTPUT_JSON"
  echo "Wrote benchmark summary: $OUTPUT_JSON"
fi

echo "$summary_json" | jq
