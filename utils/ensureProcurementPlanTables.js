const pool = require('../config/db');
// Planning commands must never create tables or cache uncommitted DDL. Apply
// manual SQL 056 before enabling the secured planning capabilities.
module.exports = async (client = pool) => {
  const result = await client.query(`SELECT
    to_regclass('public.procurement_plan_items') IS NOT NULL AND
    to_regclass('public.procurement_plan_item_requests') IS NOT NULL AND
    to_regclass('public.procurement_plan_item_consumptions') IS NOT NULL AS planning_tables_available`);
  if (result.rows[0]?.planning_tables_available !== true)
    throw Object.assign(new Error('Apply the complete manual SQL 056 planning authorization patch'), { statusCode: 503, code: 'PLANNING_SCOPE_SCHEMA_REQUIRED' });
};
