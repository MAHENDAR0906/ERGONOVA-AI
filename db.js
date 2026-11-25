
const path = require("path");
const fs = require("fs");
require("dotenv").config({
  path: path.join(__dirname, ".env")
});

const mysql = require("mysql2");

// Load the Aiven CA certificate if its path is configured.
// Set DB_CA_PATH in .env to the downloaded CA certificate's path.
const caPath = process.env.DB_CA_PATH;
let sslConfig;

if (caPath) {
  sslConfig = {
    ca: fs.readFileSync(path.resolve(__dirname, caPath), "utf8"),
    rejectUnauthorized: true
  };
} else {
  // TLS enabled, with normal certificate verification.
  // If Aiven requires its specific CA, configure DB_CA_PATH.
  sslConfig = {
    rejectUnauthorized: true
  };
}

console.log("Database configuration:", {
  DB_HOST: process.env.DB_HOST,
  DB_USER: process.env.DB_USER,
  DB_NAME: process.env.DB_NAME,
  DB_PORT: process.env.DB_PORT,
  DB_PASSWORD: process.env.DB_PASSWORD ? "SET" : "MISSING"
});

if (
  !process.env.DB_HOST ||
  !process.env.DB_USER ||
  !process.env.DB_PASSWORD ||
  !process.env.DB_NAME ||
  !process.env.DB_PORT
) {
  throw new Error("Missing required MySQL environment variables.");
}

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: sslConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 15000
});

db.getConnection((err, connection) => {
  if (err) {
    console.error("MySQL connection failed:", err.code || err.message);
    return;
  }

  console.log("MySQL connected successfully");
  connection.release();
});

module.exports = db;

