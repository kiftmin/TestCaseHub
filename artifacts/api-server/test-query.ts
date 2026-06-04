import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@workspace/db";
import { eq } from "drizzle-orm";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });

  try {
    const db = drizzle(pool, { schema });
    console.log("DB created, querying...");
    const result = await db.select().from(schema.defects).where(eq(schema.defects.project_id, 1));
    console.log("SUCCESS:", JSON.stringify(result));
  } catch (e) {
    console.error("ERROR:", e instanceof Error ? e.message : e);
    console.error("STACK:", e instanceof Error ? e.stack : "");
  } finally {
    await pool.end();
  }
}

main();
