// Apply the schema idempotently (Local start composition).
import { pool } from "../core/db.js";
import { SCHEMA_SQL } from "../core/schema.js";

export async function migrate(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

// Allow running directly: `node dist/server/migrate.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => { console.log("schema applied"); return pool.end(); })
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
