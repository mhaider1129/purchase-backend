const pool = require('../config/db');
// Read-only preflight. Ownership must be installed/reconciled manually, never
// inferred from the current assignee or created by request-time DDL.
module.exports = async (client = pool) => {
  const result = await client.query(`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='request_auto_assignment_rules' AND column_name='institute_id')
    AND to_regclass('public.request_auto_assignment_rules_institute_scope') IS NOT NULL AS assignment_scope_available`);
  if (result.rows[0]?.assignment_scope_available !== true)
    throw Object.assign(new Error('Apply complete manual SQL 057 and reconcile autoassignment rule ownership'), { statusCode: 503, code: 'ASSIGNMENT_SCOPE_SCHEMA_REQUIRED' });
};
