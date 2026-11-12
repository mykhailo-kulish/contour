#!/usr/bin/env bash
# Build a CONTOUR_DATABASE_URL for an Amazon RDS/Aurora PostgreSQL cluster using
# a freshly generated IAM auth token as the password. The token is short-lived
# (~15 min), so this MUST be run at start time, not baked into a file.
#
# Usage:
#   export AWS_PROFILE=<your-profile>          # a profile with a live session
#   export RDS_HOST=<cluster-endpoint-host>    # required; no default
#   eval "$(contour-engine/scripts/rds-url.sh)"   # exports CONTOUR_DATABASE_URL
# or:
#   CONTOUR_DATABASE_URL="$(contour-engine/scripts/rds-url.sh --print)" npm start
#
# Env: RDS_HOST (required), RDS_PORT, RDS_DB, RDS_USER, AWS_REGION, AWS_PROFILE.
# Region, if unset, is resolved by the AWS CLI from the profile/environment.
set -euo pipefail

RDS_HOST="${RDS_HOST:?set RDS_HOST to your RDS/Aurora cluster endpoint}"
RDS_PORT="${RDS_PORT:-5432}"
RDS_DB="${RDS_DB:-contour}"
RDS_USER="${RDS_USER:-postgres}"

region_args=()
[ -n "${AWS_REGION:-}" ] && region_args=(--region "$AWS_REGION")

TOKEN="$(aws rds generate-db-auth-token \
  --hostname "$RDS_HOST" \
  --port "$RDS_PORT" \
  --username "$RDS_USER" \
  "${region_args[@]}")"

# URL-encode the token (it contains '&', '=', '/', etc.) for safe use in a URL.
ENC_TOKEN="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$TOKEN")"

URL="postgresql://${RDS_USER}:${ENC_TOKEN}@${RDS_HOST}:${RDS_PORT}/${RDS_DB}?sslmode=require"

if [ "${1:-}" = "--print" ]; then
  printf '%s\n' "$URL"
else
  printf 'export CONTOUR_DATABASE_URL=%q\n' "$URL"
fi
