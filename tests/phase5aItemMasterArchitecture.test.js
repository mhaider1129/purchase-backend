const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = read('sql/migrations/20260727_item_master_foundation.sql');
const report = read('docs/architecture/phase5a-item-master-audit-report.md');
const inventory = read('docs/architecture/phase5a-item-identity-inventory.md');
const writers = read('docs/architecture/phase5a-item-writer-boundaries.md');
const names = read('docs/architecture/phase5a-name-based-identity-debt.md');
const diagnostics = read('sql/manual/007_phase5a_item_master_diagnostics.sql');

describe('Phase 5A current item-master boundaries', () => {
  test('recognizes the three-level hierarchy and mandatory parent relationships', () => {
    expect(report).toMatch(/Generic Item → Approved Product → Supplier Catalog Item/);
    expect(migration).toMatch(/approved_products[\s\S]*generic_item_id BIGINT NOT NULL REFERENCES generic_items\(id\)/);
    expect(migration).toMatch(/supplier_catalog_items[\s\S]*approved_product_id BIGINT NOT NULL REFERENCES approved_products\(id\)/);
  });

  test('does not introduce a fourth parallel master', () => {
    expect(report).toMatch(/No fourth Item Master is proposed or introduced/);
    expect(diagnostics).not.toMatch(/\bCREATE\s+TABLE\b/i);
  });

  test('recognizes mappings and transaction foreign keys', () => {
    expect(migration).toMatch(/legacy_item_mappings[\s\S]*generic_item_id BIGINT NOT NULL REFERENCES generic_items\(id\)/);
    expect(migration).toMatch(/requested_items ADD COLUMN IF NOT EXISTS generic_item_id/);
    expect(migration).toMatch(/preferred_product_id BIGINT REFERENCES approved_products/);
    expect(migration).toMatch(/mandatory_product_id BIGINT REFERENCES approved_products/);
    expect(migration).toMatch(/stock_items ADD COLUMN IF NOT EXISTS generic_item_id/);
  });

  test('diagnostic SQL is mutation and DDL free', () => {
    const executable = diagnostics.replace(/^\s*--.*$/gm, '');
    expect(executable).not.toMatch(/\b(CREATE|ALTER|UPDATE|INSERT|DELETE|DROP|TRUNCATE|MERGE|CALL|COPY|GRANT|REVOKE)\b/i);
    expect(executable).toMatch(/\bSELECT\b/i);
  });

  test('documents both legacy masters and reachable runtime DDL', () => {
    expect(inventory).toMatch(/`item_master`/);
    expect(inventory).toMatch(/`item_master_items`/);
    expect(writers).toMatch(/ensureItemMasterTables\.js/);
    expect(writers).toMatch(/is reachable/);
  });

  test('records name identity debt and floating-point money violations', () => {
    expect(names).toMatch(/IDENTITY RESOLUTION/);
    expect(names).toMatch(/legacyStockItemRepository\.findByNormalizedName/);
    expect(writers).toMatch(/Number.*parseFloat/);
    expect(writers).toMatch(/catalog validator coerces `unit_price`/);
  });
});