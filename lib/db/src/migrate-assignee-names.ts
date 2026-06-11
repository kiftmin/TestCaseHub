import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import * as dotenv from "dotenv";
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

async function main() {
  // First, show all system notes with their IDs for debugging
  const allSystemNotes = await db.execute(sql`
    SELECT id, LEFT(note, 120) AS preview FROM "defect_notes"
    WHERE "is_system_note" = true ORDER BY id
  `);
  console.log(`Found ${allSystemNotes.rows.length} total system notes`);
  for (const row of allSystemNotes.rows as { id: number; preview: string }[]) {
    console.log(`  [${row.id}] ${row.preview}`);
  }

  // Find all system notes referencing "Assigned to user #N"
  const notes = await db.execute(sql`
    SELECT id, note FROM "defect_notes"
    WHERE "is_system_note" = true
    AND "note" ~ 'Assigned to user #[0-9]+'
  `);
  console.log(`Found ${notes.rows.length} notes matching 'Assigned to user #N'`);

  let updated = 0;
  for (const row of notes.rows as { id: number; note: string }[]) {
    const userIdMatch = row.note.match(/Assigned to user #(\d+)/);
    if (!userIdMatch) continue;

    const userId = Number(userIdMatch[1]);
    const userResult = await db.execute(sql`
      SELECT name FROM "users" WHERE id = ${userId}
    `);
    const userName = (userResult.rows as { name: string }[])[0]?.name;

    if (!userName) {
      console.log(`  Skipping note ${row.id}: user #${userId} not found`);
      continue;
    }

    const updatedNote = row.note.replace(
      `Assigned to user #${userId}`,
      `Assigned to ${userName}`
    );

    await db.execute(sql`
      UPDATE "defect_notes" SET "note" = ${updatedNote} WHERE "id" = ${row.id}
    `);
    updated++;
  }

  console.log(`Updated ${updated} system notes with user names`);
  await pool.end();
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
