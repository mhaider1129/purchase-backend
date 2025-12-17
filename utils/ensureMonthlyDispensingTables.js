const pool = require('../config/db');

const ensureMonthlyDispensingTables = async (client = pool) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS monthly_dispensing (
      id SERIAL PRIMARY KEY,
      month_start DATE NOT NULL,
      item_name TEXT NOT NULL,
      quantity NUMERIC NOT NULL DEFAULT 0,
      unit TEXT,
      facility_name TEXT,
      notes TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_monthly_dispensing_month ON monthly_dispensing (month_start)`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_monthly_dispensing_item ON monthly_dispensing (LOWER(item_name))`
  );
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_monthly_dispensing_month_item_facility
       ON monthly_dispensing (month_start, item_name, COALESCE(facility_name, ''))`
  );
};

module.exports = ensureMonthlyDispensingTables;