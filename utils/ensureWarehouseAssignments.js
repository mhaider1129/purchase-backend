const pool = require('../config/db');
let validationPromise;

/** Read-only compatibility validator. Schema changes belong in sql/manual. */
module.exports = async function validateWarehouseAssignments(client = pool) {
  if (process.env.NODE_ENV === 'test') return;
  if (validationPromise) return validationPromise;
  const runner = client.query ? client : pool;
  validationPromise = runner.query(
    `SELECT to_regclass('public.warehouses') AS warehouses,
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='warehouse_id') AS user_column,
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='requests' AND column_name='supply_warehouse_id') AS request_column`
  ).then(({ rows }) => {
    const schema = rows[0] || {};
    if (!schema.warehouses || !schema.user_column || !schema.request_column) {
      const error = new Error('Warehouse assignment schema is missing; review sql/manual/001_foundation_schema_requirements.sql');
      error.code = 'SCHEMA_VALIDATION_FAILED';
      throw error;
    }
  }).catch(error => { validationPromise = null; throw error; });
  return validationPromise;
};