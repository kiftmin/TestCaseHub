import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@workspace/db";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 300_000,
  connectionTimeoutMillis: 15000,
});

pool.on("error", (err) => {
  console.error("Unexpected pool error", err);
});

export const db = drizzle(pool, { schema });
export { pool };

async function keepAlive() {
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
  } catch {
    // pool will recover on next query
  }
}
setInterval(keepAlive, 120_000).unref();

// Warm up connection on startup
try {
  const client = await pool.connect();
  client.release();
} catch {
  // will retry on first query
}
