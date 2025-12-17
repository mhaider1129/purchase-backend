const pool = require('../config/db');

const ensureRiskRegisterTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS risk_register (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT,
      description TEXT,
      likelihood TEXT NOT NULL DEFAULT 'possible',
      impact TEXT NOT NULL DEFAULT 'moderate',
      risk_score INTEGER NOT NULL DEFAULT 9,
      status TEXT NOT NULL DEFAULT 'open',
      owner TEXT,
      response_plan TEXT,
      due_date DATE,
      medication_risk JSONB,
      high_risk_item JSONB,
      supplier_risk JSONB,
      created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    ALTER TABLE risk_register
      ADD COLUMN IF NOT EXISTS medication_risk JSONB,
      ADD COLUMN IF NOT EXISTS high_risk_item JSONB,
      ADD COLUMN IF NOT EXISTS supplier_risk JSONB
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS risk_register_status_idx
      ON risk_register(status)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS risk_register_due_date_idx
      ON risk_register(due_date)
  `);
};

module.exports = ensureRiskRegisterTable;