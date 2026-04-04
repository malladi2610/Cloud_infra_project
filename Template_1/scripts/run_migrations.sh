#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./Template_1/scripts/run_migrations.sh cloud
#   ./Template_1/scripts/run_migrations.sh local

MODE="${1:-cloud}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MIGRATION_FILE="${TEMPLATE_DIR}/app/migration/001_init.sql"

if [[ ! -f "${MIGRATION_FILE}" ]]; then
  echo "Migration file not found: ${MIGRATION_FILE}" >&2
  exit 1
fi

run_local() {
  local db_user="${LOCAL_DB_USER:-classifier}"
  local db_name="${LOCAL_DB_NAME:-classifier}"

  docker compose \
    --env-file "${TEMPLATE_DIR}/.env" \
    -f "${TEMPLATE_DIR}/docker-compose.yml" \
    exec -T postgres \
    psql -U "${db_user}" -d "${db_name}" -v ON_ERROR_STOP=1 \
    < "${MIGRATION_FILE}"
}

run_cloud() {
  # Required cloud variables.
  local host="${CLOUD_DB_HOST:-}"
  local user="${CLOUD_DB_USER:-}"
  local pass="${CLOUD_DB_PASSWORD:-${TF_VAR_postgres_admin_password:-}}"

  # Optional cloud variables.
  local port="${CLOUD_DB_PORT:-5432}"
  local db_name="${CLOUD_DB_NAME:-classifier}"
  local sslmode="${CLOUD_DB_SSLMODE:-require}"

  if [[ -z "${host}" || -z "${user}" || -z "${pass}" ]]; then
    cat >&2 <<'EOF'
Missing required environment variables for cloud mode.
Set:
  CLOUD_DB_HOST        (example: <server>.postgres.database.azure.com)
  CLOUD_DB_USER        (example: pgadmincp9)
  CLOUD_DB_PASSWORD    (or TF_VAR_postgres_admin_password)
Optional:
  CLOUD_DB_PORT        (default: 5432)
  CLOUD_DB_NAME        (default: classifier)
  CLOUD_DB_SSLMODE     (default: require)
EOF
    exit 1
  fi

  docker run --rm \
    -e PGPASSWORD="${pass}" \
    -v "${MIGRATION_FILE}:/migrations/001_init.sql:ro" \
    postgres:16 \
    psql "host=${host} port=${port} dbname=${db_name} user=${user} sslmode=${sslmode}" \
      -v ON_ERROR_STOP=1 \
      -f /migrations/001_init.sql
}

case "${MODE}" in
  local)
    echo "Running migration in local mode..."
    run_local
    ;;
  cloud)
    echo "Running migration in cloud mode..."
    run_cloud
    ;;
  *)
    echo "Unknown mode: ${MODE}" >&2
    echo "Usage: $0 [cloud|local]" >&2
    exit 1
    ;;
esac

echo "Migration completed successfully."
