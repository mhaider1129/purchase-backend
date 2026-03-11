const pool = require('../config/db');

let tablesEnsured = false;
let tablesEnsuredPromise = null;

const ensureProcurementPlanTables = async (client = pool) => {
  if (tablesEnsured) return;
  if (!tablesEnsuredPromise) {
    tablesEnsuredPromise = (async () => {
      const runner = client.query ? client : pool;

      const statements = [
        `CREATE TABLE IF NOT EXISTS public.procurement_plan_items (
          id SERIAL PRIMARY KEY,
          plan_id INTEGER NOT NULL REFERENCES procurement_plans(id) ON DELETE CASCADE,
          stock_item_id INTEGER REFERENCES stock_items(id),
          item_name TEXT NOT NULL,
          description TEXT,
          unit_of_measure TEXT,
          planned_quantity NUMERIC NOT NULL,
          planned_unit_cost NUMERIC,
          planned_total_cost NUMERIC,
          currency TEXT,
          needed_by_date DATE,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS public.procurement_plan_item_requests (
          id SERIAL PRIMARY KEY,
          plan_item_id INTEGER NOT NULL REFERENCES procurement_plan_items(id) ON DELETE CASCADE,
          request_id INTEGER REFERENCES requests(id),
          requested_item_id INTEGER REFERENCES requested_items(id),
          quantity NUMERIC NOT NULL,
          unit_cost NUMERIC,
          total_cost NUMERIC,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (plan_item_id, requested_item_id)
        )`,
        `CREATE TABLE IF NOT EXISTS public.procurement_plan_item_consumptions (
          id SERIAL PRIMARY KEY,
          plan_item_id INTEGER NOT NULL REFERENCES procurement_plan_items(id) ON DELETE CASCADE,
          warehouse_stock_movement_id INTEGER REFERENCES warehouse_stock_movements(id),
          department_stock_movement_id INTEGER REFERENCES department_stock_movements(id),
          quantity NUMERIC NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          CHECK (warehouse_stock_movement_id IS NOT NULL OR department_stock_movement_id IS NOT NULL),
          UNIQUE (plan_item_id, warehouse_stock_movement_id, department_stock_movement_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_plan_items_plan ON public.procurement_plan_items(plan_id)`,
        `CREATE INDEX IF NOT EXISTS idx_plan_item_requests_item ON public.procurement_plan_item_requests(plan_item_id)`,
        `CREATE INDEX IF NOT EXISTS idx_plan_item_consumptions_item ON public.procurement_plan_item_consumptions(plan_item_id)`
      ];

      for (const statement of statements) {
        await runner.query(statement);
      }

      tablesEnsured = true;
    })().catch((error) => {
      tablesEnsuredPromise = null;
      throw error;
    });
  }

  await tablesEnsuredPromise;
};

module.exports = ensureProcurementPlanTables;