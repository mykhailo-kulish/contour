// PostgreSQL connection pool and a tiny query helper.
import pg from "pg";

const { Pool } = pg;

function databaseUrl(): string {
  return (
    process.env.CONTOUR_DATABASE_URL ||
    "postgresql://contour:contour@localhost:5432/contour"
  );
}

export const pool = new Pool({ connectionString: databaseUrl() });

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
