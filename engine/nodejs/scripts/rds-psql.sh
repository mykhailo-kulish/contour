#!/usr/bin/env bash
# Thin wrapper: run psql against an Amazon RDS/Aurora cluster with a freshly
# generated IAM token. Args after the DB name are passed to psql.
#
#   export AWS_PROFILE=<your-profile>
#   export RDS_HOST=<cluster-endpoint-host>
#   scripts/rds-psql.sh <dbname> [psql args...]
#   scripts/rds-psql.sh postgres -c '\l'
#
# Requires: AWS_PROFILE with a live session; a libpq `psql` on PATH.
# Env: RDS_HOST (required), RDS_PORT, RDS_USER, AWS_REGION. Region, if unset,
# is resolved by the AWS CLI from the profile/environment.
set -euo pipefail

RDS_HOST="${RDS_HOST:?set RDS_HOST to your RDS/Aurora cluster endpoint}"
RDS_PORT="${RDS_PORT:-5432}"
RDS_USER="${RDS_USER:-postgres}"

DB="${1:-postgres}"; shift || true

region_args=()
[ -n "${AWS_REGION:-}" ] && region_args=(--region "$AWS_REGION")

PGPASSWORD="$(aws rds generate-db-auth-token \
  --hostname "$RDS_HOST" --port "$RDS_PORT" \
  --username "$RDS_USER" "${region_args[@]}")"
export PGPASSWORD

exec psql "host=$RDS_HOST port=$RDS_PORT dbname=$DB user=$RDS_USER sslmode=require" "$@"
