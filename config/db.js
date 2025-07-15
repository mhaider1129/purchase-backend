// config/db.js
const { Pool } = require('pg');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';
const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error('❌ DATABASE_URL is not set in .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: isProduction ? { rejectUnauthorized: false } : false, // Disable SSL locally
});

// Successful Connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

// Connection Error Handler
pool.on('error', (err) => {
  console.error('❌ Unexpected DB connection error:', err.stack);
  process.exit(-1);
});

module.exports = pool;
