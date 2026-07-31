const CAPABILITY_OBJECTS = Object.freeze({
  itemMasterFoundationAvailable: [
    "generic_items",
    "approved_products",
    "item_categories",
    "item_uom",
    "item_manufacturers",
  ],
  stockItemIdentityAvailable: ["stock_items"],
  stockMappingAvailable: ["stock_item_master_mappings"],
  stockImportAvailable: [
    "stock_item_import_batches",
    "stock_item_migration_staging",
  ],
  warehouseSupplyIdentityAvailable: ["warehouse_supply_request_items"],
  normalizedRequestIdentityAvailable: ["requested_items"],
  normalizedPoIdentityAvailable: ["purchase_order_items"],
  normalizedReceiptIdentityAvailable: ["goods_receipt_items"],
  legacyStockItemExceptionAvailable: [
    "stock_items",
    "item_master_audit_events",
  ],
});

const CAPABILITY_COLUMNS = Object.freeze({
  legacyStockItemExceptionAvailable: [["stock_items", "identity_source"]],
});
class DatabaseCapabilityService {
  constructor(db, { ttlMs = 30000 } = {}) {
    this.db = db;
    this.ttlMs = ttlMs;
    this.cache = null;
    this.expiresAt = 0;
  }

  async detect({ refresh = false } = {}) {
    if (!refresh && this.cache && Date.now() < this.expiresAt) {
      return { ...this.cache };
    }

    const safe = Object.fromEntries(
      Object.keys(CAPABILITY_OBJECTS).map((key) => [key, false]),
    );

    try {
      const names = [...new Set(Object.values(CAPABILITY_OBJECTS).flat())];
      const result = await this.db.query(
        `SELECT table_name, column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ANY($1::text[])`,
        [names],
      );
      const tables = new Set(result.rows.map((row) => row.table_name));
      const columns = new Set(
        result.rows.map((row) => `${row.table_name}.${row.column_name}`),
      );

      for (const [key, requiredTables] of Object.entries(CAPABILITY_OBJECTS)) {
        const requiredColumns = CAPABILITY_COLUMNS[key] || [];
        safe[key] =
          requiredTables.every((name) => tables.has(name)) &&
          requiredColumns.every(([table, column]) =>
            columns.has(`${table}.${column}`),
          );
      }
    } catch (_error) {
      // Capability discovery deliberately fails closed without database details.
    }

    this.cache = Object.freeze(safe);
    this.expiresAt = Date.now() + this.ttlMs;
    return { ...safe };
  }

  async require(capability) {
    const state = await this.detect();
    if (!state[capability]) {
      const error = new Error("Required database capability is unavailable");
      error.statusCode = 503;
      error.code = "database_capability_unavailable";
      throw error;
    }
  }

  refresh() {
    return this.detect({ refresh: true });
  }
}

module.exports = {
  CAPABILITY_OBJECTS,
  CAPABILITY_COLUMNS,
  DatabaseCapabilityService,
};