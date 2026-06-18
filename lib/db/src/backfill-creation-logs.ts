import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import * as dotenv from "dotenv";
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

async function main() {
  const defects = await db.execute(sql`
    SELECT d.id, d.created_at, d.assigned_to_user_id, d.project_id
    FROM "defects" d
    WHERE NOT EXISTS (
      SELECT 1 FROM "defect_notes" dn
      WHERE dn.defect_id = d.id
      AND dn.is_system_note = true
      AND dn.note LIKE '%''NEW''%'
    )
    ORDER BY d.id
  `);

  console.log(`Defects missing creation log: ${defects.rows.length}`);

  let inserted = 0;
  for (const row of defects.rows as { id: number; created_at: Date; assigned_to_user_id: number | null; project_id: number }[]) {
    const systemUserId = row.assigned_to_user_id ?? 1;
    const note = `System Note: Defect status changed from 'N/A' to 'NEW' by System.`;

    await db.execute(sql`
      INSERT INTO "defect_notes" ("defect_id", "added_by_user_id", "note", "is_system_note", "created_at")
      VALUES (${row.id}, ${systemUserId}, ${note}, true, ${row.created_at})
    `);
    inserted++;
  }

  console.log(`Inserted ${inserted} creation log(s).`);
  await pool.end();
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
