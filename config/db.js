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
  Client: require("../utils/runtimeDatabaseIdentity").clientClass(),
  connectionString: dbUrl,
  ssl: isProduction ? { rejectUnauthorized: false } : false, // Disable SSL locally
  keepAlive: true,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

const {guard}=require('../utils/runtimeSqlGuard');
guard(pool);
pool.on('connect',client=>{guard(client);require('../utils/runtimeSchemaContract').registerClient(client,pool);});

// Successful Connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

// Connection Error Handler with graceful recovery
let reconnecting = false;

const attemptReconnect = () => {
  if (reconnecting) {
    return;
  }

  reconnecting = true;
  console.warn('🔄 Attempting to re-establish PostgreSQL connection after an error...');

  pool
    .connect()
    .then((client) => {
      client.release();
      console.log('✅ PostgreSQL connection re-established');
    })
    .catch((connectionError) => {
      console.error('❌ PostgreSQL reconnection attempt failed:', connectionError.message);
    })
    .finally(() => {
      reconnecting = false;
    });
};

pool.on('error', (err) => {
  console.error('❌ Unexpected DB connection error:', err.stack || err);
  attemptReconnect();
});

module.exports = pool;