const pool = require('../config/db');

let maintenanceRequestSchemaEnsured = false;

/**
 * Backfill additive columns used by maintenance request submissions.
 *
 * Long-lived deployments can have a requests table created before maintenance
 * workflows gained technician tracking, target sections, and temporary
 * requester names. Ensuring those columns before insert prevents valid
 * maintenance submissions from failing with an opaque 500.
 */
const ensureMaintenanceRequestSchema = async (client = pool) => {
  if (maintenanceRequestSchemaEnsured || process.env.NODE_ENV === 'test') {
    maintenanceRequestSchemaEnsured = true;
    return;
  }

  const runner = client.query ? client : pool;

  await runner.query(
    `ALTER TABLE IF EXISTS public.requests ADD COLUMN IF NOT EXISTS maintenance_ref_number TEXT`,
  );
  await runner.query(
    `ALTER TABLE IF EXISTS public.requests ADD COLUMN IF NOT EXISTS initiated_by_technician_id INTEGER`,
  );
  await runner.query(
    `ALTER TABLE IF EXISTS public.requests ADD COLUMN IF NOT EXISTS section_id INTEGER`,
  );
  await runner.query(
    `ALTER TABLE IF EXISTS public.requests ADD COLUMN IF NOT EXISTS temporary_requester_name TEXT`,
  );

  await runner.query(
    `CREATE INDEX IF NOT EXISTS idx_requests_initiated_by_technician_id
       ON public.requests(initiated_by_technician_id)`,
  );
  await runner.query(
    `CREATE INDEX IF NOT EXISTS idx_requests_maintenance_ref_number
       ON public.requests(maintenance_ref_number)`,
  );

  maintenanceRequestSchemaEnsured = true;
};

module.exports = ensureMaintenanceRequestSchema;