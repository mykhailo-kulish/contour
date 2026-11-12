#!/usr/bin/env bash
# Load a SQL dump file into a database on an Amazon RDS/Aurora cluster using a
# freshly generated IAM token. The token is generated once, immediately before
# the load.
#
#   export AWS_PROFILE=<your-profile>
#   export RDS_HOST=<cluster-endpoint-host>
#   scripts/rds-load.sh <dbname> <dumpfile.sql>
#
# Env: RDS_HOST (required), RDS_PORT, RDS_USER, AWS_REGION. Region, if unset,
# is resolved by the AWS CLI from the profile/environment.
set -euo pipefail

RDS_HOST="${RDS_HOST:?set RDS_HOST to your RDS/Aurora cluster endpoint}"
RDS_PORT="${RDS_PORT:-5432}"
RDS_USER="${RDS_USER:-postgres}"

DB="$1"; DUMP="$2"

region_args=()
[ -n "${AWS_REGION:-}" ] && region_args=(--region "$AWS_REGION")

PGPASSWORD="$(aws rds generate-db-auth-token \
  --hostname "$RDS_HOST" --port "$RDS_PORT" \
  --username "$RDS_USER" "${region_args[@]}")"
export PGPASSWORD

psql "host=$RDS_HOST port=$RDS_PORT dbname=$DB user=$RDS_USER sslmode=require" \
  -v ON_ERROR_STOP=1 -f "$DUMP"
