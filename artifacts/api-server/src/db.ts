import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@workspace/db";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 20,
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
    await pool.query("SELECT 1");
  } catch {
    // pool will recover on next query
  }
}
setInterval(keepAlive, 120_000).unref();

// Warm up connection on startup
try {
  const client = await pool.connect();
  client.on("error", () => {});
  console.log("[startup] Running DB cleanup & index migration...");

  // Clean up duplicate executions keeping only the latest per run+case
  const execResult = await client.query(`
    DELETE FROM executions e1 USING (
      SELECT test_run_id, test_case_id, MAX(id) AS max_id
      FROM executions
      GROUP BY test_run_id, test_case_id
      HAVING COUNT(*) > 1
    ) dup
    WHERE e1.test_run_id = dup.test_run_id
      AND e1.test_case_id = dup.test_case_id
      AND e1.id <> dup.max_id
  `);
  if (execResult.rowCount && execResult.rowCount > 0) {
    console.log(`[startup] Removed ${execResult.rowCount} duplicate execution(s)`);
  }

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_executions_run_case
    ON executions (test_run_id, test_case_id)
  `);

  // Clean up duplicate step_results keeping only the most recently updated row. This prevents startup
  // cleanup from reverting user data when old duplicate rows exist. We order by recorded_at DESC, then id DESC
  // to deterministically keep the latest updated row (or the highest id in case of identical timestamps).
  const srResult = await client.query(`
    DELETE FROM step_results
    WHERE id IN (
      SELECT id
      FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY execution_id, step_id ORDER BY recorded_at DESC, id DESC) as rn
        FROM step_results
      ) ranked
      WHERE ranked.rn > 1
    )
  `);
  if (srResult.rowCount && srResult.rowCount > 0) {
    console.log(`[startup] Removed ${srResult.rowCount} duplicate step_result(s), keeping latest by recorded_at`);
  }

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_step_results_exec_step
    ON step_results (execution_id, step_id)
  `);

  client.release();
  console.log("[startup] DB cleanup complete");
} catch (err) {
  console.error("[startup] DB cleanup failed:", err);
}
