import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import * as dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();

  const db = drizzle(client);

  console.log("Running Drizzle migrations...");
  await migrate(db, {
    migrationsFolder: join(__dirname, "..", "drizzle"),
  });

  const rawSqlFiles = [
    "0001_add_sort_order.sql",
    "0003_conformance_audit.sql",
    "0005_test_run_use_cases_updated_at.sql",
    "0006_backfill_use_case_status.sql",
    "0007_test_steps_unique_step_number.sql",
    "0010_reset_defects_to_new.sql",
    "0012_reset_defects_for_testing.sql",
    "0017_add_test_case_precondition.sql",
  ];
  for (const file of rawSqlFiles) {
    const rawSqlPath = join(__dirname, "..", "drizzle", file);
    try {
      const sql = readFileSync(rawSqlPath, "utf-8");
      const statements = sql.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        if (stmt) {
          await client.query(stmt);
          console.log(`  [${file}] Executed: ${stmt.substring(0, 80)}...`);
        }
      }
      console.log(`Raw SQL migration ${file} complete!`);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        console.log(`No raw SQL migration file found (${file}), skipping.`);
      } else {
        console.error(`Raw SQL migration ${file} failed:`, err);
        process.exit(1);
      }
    }
  }

  await client.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
