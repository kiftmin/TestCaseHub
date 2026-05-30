import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { users } from "./schema.js";

dotenv.config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();

  const db = drizzle(client);

  // Seed initial admin user if doesn't exist
  const adminPassword = await bcrypt.hash("admin123", 10);

  const result = await client.query(
    `SELECT id FROM users WHERE username = 'admin'`
  );

  if (result.rows.length === 0) {
    await db.insert(users).values({
      username: "admin",
      password_hash: adminPassword,
      name: "System Administrator",
      email: "admin@testcasehub.com",
      role: "ADMIN",
      is_active: true,
    });
    console.log("Seeded admin user (admin / admin123)");
  } else {
    console.log("Admin user already exists.");
  }

  await client.end();
  console.log("Seeding complete!");
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
