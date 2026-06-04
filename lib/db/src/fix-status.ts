import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import * as dotenv from "dotenv";
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

const MAPPING: Record<string, string> = {
  "New Defect": "NEW",
  "Submitted to Dev to Fix": "ASSIGNED",
  "Ready for Testing": "READY_FOR_VERIFICATION",
  "Accepted by Business": "CLOSED",
};

async function main() {
  for (const [oldStatus, newStatus] of Object.entries(MAPPING)) {
    const result = await db.execute(sql`
      UPDATE "defects" SET "status" = ${newStatus} WHERE "status" = ${oldStatus}
    `);
    if (result.rowCount && result.rowCount > 0) {
      console.log(`Mapped "${oldStatus}" → "${newStatus}": ${result.rowCount} rows`);
    }
  }

  const counts = await db.execute(sql`
    SELECT "status", COUNT(*) FROM "defects" GROUP BY "status" ORDER BY "status"
  `);
  console.log("\nFinal status distribution:");
  for (const row of counts.rows as { status: string; count: string }[]) {
    const valid = ["NEW", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "BLOCKED", "RESOLVED_DEV", "READY_FOR_VERIFICATION", "REGRESSED", "CLOSED", "PASSED_BY_AGREEMENT"].includes(row.status);
    console.log(`  ${valid ? "✓" : "✗"} ${row.status}: ${row.count}`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
