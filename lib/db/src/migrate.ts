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

  console.log("Running raw SQL migrations...");
  const rawSqlPath = join(__dirname, "..", "drizzle", "0001_add_sort_order.sql");
  try {
    const sql = readFileSync(rawSqlPath, "utf-8");
    const statements = sql.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      if (stmt) {
        await client.query(stmt);
        console.log(`  Executed: ${stmt.substring(0, 80)}...`);
      }
    }
    console.log("Raw SQL migrations complete!");
  } catch (err: any) {
    if (err.code === "ENOENT") {
      console.log("No raw SQL migration file found, skipping.");
    } else {
      console.error("Raw SQL migration failed:", err);
      process.exit(1);
    }
  }

  await client.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
