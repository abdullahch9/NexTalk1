const mysql = require("mysql2/promise");
require("dotenv").config({ path: require("path").join(__dirname, "../.env"), quiet: true });

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  connectTimeout: 10000,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 100,
  namedPlaceholders: true,
});

module.exports = db;
