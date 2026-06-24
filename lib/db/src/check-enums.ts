import { Client } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: "../../api-server/.env" });

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();

  const res = await client.query("SELECT typname FROM pg_type WHERE typtype = 'e'");
  console.log("Enum types in database:");
  for (const row of res.rows) {
    console.log(" -", row.typname);
  }

  await client.end();
}

main().catch((err) => {
  console.error("Query failed:", err);
  process.exit(1);
});
