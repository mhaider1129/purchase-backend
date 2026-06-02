const pool = require('../config/db');

let ensured = false;

const ensureRequestAutoAssignmentRulesTable = async (client = pool) => {
  if (ensured && client === pool) {
    return;
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS request_auto_assignment_rules (
      id SERIAL PRIMARY KEY,
      request_type VARCHAR(100) NOT NULL,
      warehouse_id INTEGER NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      assignee_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS request_auto_assignment_rules_unique_scope
      ON request_auto_assignment_rules (LOWER(request_type), COALESCE(warehouse_id, 0))
  `);

  ensured = true;
};

module.exports = ensureRequestAutoAssignmentRulesTable;