const pool = require('../config/db');

let tablesEnsured = false;
let tablesEnsuredPromise = null;


const ensureWarehouseInventoryTables = async (client = pool) => {
  if (tablesEnsured) return;
  if (!tablesEnsuredPromise) {
    tablesEnsuredPromise = (async () => {
      const runner = client.query ? client : pool;

      // Phase 3B technical-debt boundary: this helper is still called by request handlers,
      // so it may validate deployed schema but must never perform request-time DDL.
      const { rows } = await runner.query(`
        SELECT
          to_regclass('public.warehouse_stock_levels') IS NOT NULL AS balance_table,
          to_regclass('public.warehouse_stock_movements') IS NOT NULL AS movement_table,
          to_regclass('public.inventory_transactions') IS NOT NULL AS transaction_table,
          EXISTS (
            SELECT 1 FROM pg_index i
            JOIN pg_class idx ON idx.oid = i.indexrelid
            JOIN pg_class tbl ON tbl.oid = i.indrelid
            JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
            WHERE ns.nspname = 'public' AND tbl.relname = 'warehouse_stock_levels'
              AND idx.relname = 'ux_inventory_balance_identity' AND i.indisunique AND i.indisvalid
              AND i.indnullsnotdistinct AND i.indnkeyatts = 7
              AND i.indexprs IS NULL AND i.indpred IS NULL
              AND (SELECT array_agg(att.attname ORDER BY key.ordinality)
                     FROM unnest(i.indkey::smallint[]) WITH ORDINALITY key(attnum, ordinality)
                     JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = key.attnum
                    WHERE key.ordinality <= i.indnkeyatts)
                  = ARRAY['warehouse_id','stock_item_id','stock_status','batch_number',
                          'lot_number','serial_number','expiry_date']::name[]
          ) AS canonical_identity,
          NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'warehouse_stock_levels'
              AND column_name IN ('stock_status', 'batch_number', 'batch_id', 'lot_number', 'serial_number', 'expiry_date')
            GROUP BY table_schema, table_name HAVING count(*) = 6
          ) AS missing_identity_columns
      `);
      const schema = rows[0] || {};
      if (!schema.balance_table || !schema.movement_table || !schema.transaction_table
          || !schema.canonical_identity || schema.missing_identity_columns) {
        throw new Error('Inventory schema is not compatible; apply manual SQL 004 before serving inventory requests');
      }

      tablesEnsured = true;
    })().catch((error) => {
      tablesEnsuredPromise = null;
      throw error;
    });
  }

  await tablesEnsuredPromise;
};

module.exports = ensureWarehouseInventoryTables;