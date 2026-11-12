#!/usr/bin/env bash
# Start contour-engine against an Amazon RDS/Aurora cluster with IAM auth.
#
#   export AWS_PROFILE=<your-profile>          # a live session
#   export RDS_HOST=<cluster-endpoint-host>    # required; no default
#   scripts/run-rds.sh                         # runs npm start
#
# db.ts (CONTOUR_DB_IAM_AUTH=1) regenerates the IAM token per connection, so the
# server keeps working past the ~15-minute token lifetime. TLS is on (RDS
# requires it); set CONTOUR_DB_CA to the RDS CA bundle to verify the server
# certificate. Region, if unset, is resolved by the AWS CLI from the
# profile/environment.
set -euo pipefail

export CONTOUR_DB_IAM_AUTH=1
RDS_HOST="${RDS_HOST:?set RDS_HOST to your RDS/Aurora cluster endpoint}"
RDS_PORT="${RDS_PORT:-5432}"
RDS_DB="${RDS_DB:-contour}"
RDS_USER="${RDS_USER:-postgres}"
# Host/port/db/user come from the URL; the password is supplied live by db.ts.
export CONTOUR_DATABASE_URL="postgresql://${RDS_USER}@${RDS_HOST}:${RDS_PORT}/${RDS_DB}?sslmode=require"

exec npm start
