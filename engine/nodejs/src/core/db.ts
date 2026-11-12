// PostgreSQL connection pool and a tiny query helper.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";

const { Pool } = pg;

const execFileAsync = promisify(execFile);

function databaseUrl(): string {
  return (
    process.env.CONTOUR_DATABASE_URL ||
    "postgresql://contour:contour@localhost:5432/contour"
  );
}

// Build the pg Pool config from the connection URL. For Amazon RDS/Aurora we add
// two things the plain connection string can't carry by itself:
//   * TLS — RDS requires it; `pg` does not turn `?sslmode=require` into a TLS
//     config on its own, so we set `ssl` explicitly.
//   * IAM auth tokens — when CONTOUR_DB_IAM_AUTH=1, the password is a short-lived
//     (~15 min) token from `aws rds generate-db-auth-token`. A static password in
//     the URL would go stale, so we supply an async `password` callback that `pg`
//     calls for every new connection, regenerating the token each time.
function poolConfig(): pg.PoolConfig {
  const url = new URL(databaseUrl());
  const sslmode = url.searchParams.get("sslmode");
  const iamAuth = process.env.CONTOUR_DB_IAM_AUTH === "1";

  const cfg: pg.PoolConfig = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "contour",
    user: decodeURIComponent(url.username) || "postgres",
  };

  // TLS: on when sslmode requires/prefers it, or always for IAM auth. RDS presents
  // a cert chain not in Node's default store; rejectUnauthorized can be turned on
  // by pointing CONTOUR_DB_CA at the RDS CA bundle (see scripts/rds-url.sh notes).
  if (iamAuth || (sslmode && sslmode !== "disable")) {
    cfg.ssl = { rejectUnauthorized: process.env.CONTOUR_DB_CA ? true : false };
  }

  if (iamAuth) {
    const host = url.hostname;
    const port = cfg.port ?? 5432;
    const user = cfg.user ?? "postgres";
    // Region is resolved by the AWS CLI itself (AWS_REGION / AWS_DEFAULT_REGION /
    // the active profile's config); only forwarded here when set explicitly.
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
    // pg accepts a (sync or async) function for `password`; it is invoked per new
    // connection, so each one gets a fresh IAM token.
    cfg.password = async (): Promise<string> => {
      const { stdout } = await execFileAsync("aws", [
        "rds", "generate-db-auth-token",
        "--hostname", host,
        "--port", String(port),
        "--username", user,
        ...(region ? ["--region", region] : []),
      ]);
      return stdout.trim();
    };
  } else {
    cfg.password = decodeURIComponent(url.password);
  }

  return cfg;
}

export const pool = new Pool(poolConfig());

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}

// Run fn inside a transaction (Element/Definition writes are atomic).
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
