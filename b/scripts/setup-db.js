require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mysql = require("mysql2/promise");
const { setupSchema } = require("../config/schema");

async function main() {
  const database = process.env.DB_NAME;
  if (!database || !/^[a-zA-Z0-9_]+$/.test(database)) throw new Error("DB_NAME must use letters, numbers, or underscores.");
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  });
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.changeUser({ database });
    await setupSchema(connection);
    console.log("Database tables are ready.");
  } finally { await connection.end(); }
}
main().catch((error) => { console.error("Database setup failed:", error.code || error.message); process.exitCode = 1; });
