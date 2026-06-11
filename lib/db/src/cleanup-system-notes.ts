import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import * as dotenv from "dotenv";
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

async function main() {
  // 1. Delete duplicate system notes (same note text and created_at, keep earliest id)
  const dupResult = await db.execute(sql`
    DELETE FROM "defect_notes"
    WHERE "is_system_note" = true
    AND "id" NOT IN (
      SELECT MIN("id") FROM "defect_notes"
      WHERE "is_system_note" = true
      GROUP BY "note", "created_at"
    )
  `);
  console.log(`Deleted duplicate system notes: ${dupResult.rowCount ?? 0} rows`);

  // 2. Delete system notes where the status didn't actually change (e.g. IN_PROGRESS → IN_PROGRESS)
  const allNotes = await db.execute(sql`
    SELECT id, note FROM "defect_notes" WHERE "is_system_note" = true
  `);
  const toDelete: number[] = [];
  for (const row of allNotes.rows as { id: number; note: string }[]) {
    const m = row.note.match(/from '([^']+)' to '([^']+)'/);
    if (m && m[1] === m[2]) toDelete.push(row.id);
  }
  if (toDelete.length > 0) {
    // Delete in batches of 50
    for (let i = 0; i < toDelete.length; i += 50) {
      const batch = toDelete.slice(i, i + 50);
      const ids = sql.join(batch.map(id => sql`${id}`), sql`, `);
      await db.execute(sql`DELETE FROM "defect_notes" WHERE "id" IN (${ids})`);
    }
    console.log(`Deleted same-state transition notes: ${toDelete.length} rows`);
  } else {
    console.log("Deleted same-state transition notes: 0 rows");
  }

  console.log("Cleanup complete.");
  await pool.end();
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
