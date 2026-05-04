#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./Template_2/scripts/run_migrations.sh cloud
#   ./Template_2/scripts/run_migrations.sh local

MODE="${1:-cloud}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MIGRATION_DIR="${TEMPLATE_DIR}/app/migration"

if [[ ! -d "${MIGRATION_DIR}" ]]; then
  echo "Migration directory not found: ${MIGRATION_DIR}" >&2
  exit 1
fi

MIGRATION_FILES=()
while IFS= read -r migration_file; do
  MIGRATION_FILES+=("${migration_file}")
done < <(find "${MIGRATION_DIR}" -maxdepth 1 -type f -name '*.sql' | sort)

if [[ ${#MIGRATION_FILES[@]} -eq 0 ]]; then
  echo "No migration files found in ${MIGRATION_DIR}" >&2
  exit 1
fi

run_local() {
  local db_user="${LOCAL_DB_USER:-template2}"
  local db_name="${LOCAL_DB_NAME:-template2}"

  for migration_file in "${MIGRATION_FILES[@]}"; do
    echo "Applying migration (local): ${migration_file##*/}"
    docker compose \
      --env-file "${TEMPLATE_DIR}/.env" \
      -f "${TEMPLATE_DIR}/docker-compose.yml" \
      exec -T postgres \
      psql -U "${db_user}" -d "${db_name}" -v ON_ERROR_STOP=1 \
      < "${migration_file}"
  done
}

run_cloud() {
  # Required cloud variables.
  local host="${CLOUD_DB_HOST:-}"
  local user="${CLOUD_DB_USER:-}"
  local pass="${CLOUD_DB_PASSWORD:-${TF_VAR_postgres_admin_password:-}}"

  # Optional cloud variables.
  local port="${CLOUD_DB_PORT:-5432}"
  local db_name="${CLOUD_DB_NAME:-template2}"
  local sslmode="${CLOUD_DB_SSLMODE:-require}"

  if [[ -z "${host}" || -z "${user}" || -z "${pass}" ]]; then
    cat >&2 <<'EOF_HELP'
Missing required environment variables for cloud mode.
Set:
  CLOUD_DB_HOST        (example: <server>.postgres.database.azure.com)
  CLOUD_DB_USER        (example: pgadmincp9)
  CLOUD_DB_PASSWORD    (or TF_VAR_postgres_admin_password)
Optional:
  CLOUD_DB_PORT        (default: 5432)
  CLOUD_DB_NAME        (default: template2)
  CLOUD_DB_SSLMODE     (default: require)
EOF_HELP
    exit 1
  fi

  for migration_file in "${MIGRATION_FILES[@]}"; do
    echo "Applying migration (cloud): ${migration_file##*/}"
    docker run --rm \
      -e PGPASSWORD="${pass}" \
      -v "${migration_file}:/migrations/current.sql:ro" \
      postgres:16 \
      psql "host=${host} port=${port} dbname=${db_name} user=${user} sslmode=${sslmode}" \
        -v ON_ERROR_STOP=1 \
        -f /migrations/current.sql
  done
}

case "${MODE}" in
  local)
    echo "Running migrations in local mode..."
    run_local
    ;;
  cloud)
    echo "Running migrations in cloud mode..."
    run_cloud
    ;;
  *)
    echo "Unknown mode: ${MODE}" >&2
    echo "Usage: $0 [cloud|local]" >&2
    exit 1
    ;;
esac

echo "Migrations completed successfully."
