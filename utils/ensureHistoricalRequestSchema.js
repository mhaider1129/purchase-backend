const pool = require('../config/db');
const ensureProjectsTable = require('./ensureProjectsTable');
const ensureWarehouseAssignments = require('./ensureWarehouseAssignments');

let historicalRequestSchemaEnsured = false;

/**
 * Backfill columns and tables used by the historical paper-request import.
 *
 * The import endpoint is often used on long-lived deployments whose request
 * table predates project links, temporary requester names, completion dates, or
 * warehouse supply assignments. Ensuring the dependent schema up front keeps a
 * legitimate import from surfacing as an opaque 500 when those additive columns
 * are missing.
 */
const ensureHistoricalRequestSchema = async (client = pool) => {
  if (historicalRequestSchemaEnsured || process.env.NODE_ENV === 'test') {
    historicalRequestSchemaEnsured = true;
    return;
  }

  await ensureProjectsTable(client);
  await ensureWarehouseAssignments(client);
  const runner = client.query ? client : pool;

  await runner.query(
    `ALTER TABLE IF EXISTS public.requests ADD COLUMN IF NOT EXISTS temporary_requester_name TEXT`,
  );
  await runner.query(
    `ALTER TABLE IF EXISTS public.requests ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP`,
  );
  await runner.query(
    `ALTER TABLE IF EXISTS public.requests ADD COLUMN IF NOT EXISTS institute_id INTEGER`,
  );
  await runner.query(
    `ALTER TABLE IF EXISTS public.requests ADD COLUMN IF NOT EXISTS estimated_cost BIGINT`,
  );
  await runner.query(
    `ALTER TABLE IF EXISTS public.requests ADD COLUMN IF NOT EXISTS request_domain VARCHAR DEFAULT 'operational'`,
  );

  await runner.query(
    `ALTER TABLE IF EXISTS public.requested_items ADD COLUMN IF NOT EXISTS brand TEXT`,
  );
  await runner.query(
    `ALTER TABLE IF EXISTS public.requested_items ADD COLUMN IF NOT EXISTS total_cost BIGINT`,
  );
  await runner.query(
    `ALTER TABLE IF EXISTS public.requested_items ADD COLUMN IF NOT EXISTS available_quantity INTEGER`,
  );
  await runner.query(
    `ALTER TABLE IF EXISTS public.requested_items ADD COLUMN IF NOT EXISTS intended_use TEXT`,
  );
  await runner.query(
    `ALTER TABLE IF EXISTS public.requested_items ADD COLUMN IF NOT EXISTS specs TEXT`,
  );

  await runner.query(
    `CREATE INDEX IF NOT EXISTS idx_requests_temporary_requester_name
       ON public.requests(temporary_requester_name)`,
  );

  await runner.query(
    `CREATE TABLE IF NOT EXISTS public.warehouse_supply_items (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
      requested_item_id INTEGER,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`,
  );
  await runner.query(
    `CREATE INDEX IF NOT EXISTS idx_wsi_request_id ON public.warehouse_supply_items(request_id)`,
  );

  historicalRequestSchemaEnsured = true;
};

module.exports = ensureHistoricalRequestSchema;