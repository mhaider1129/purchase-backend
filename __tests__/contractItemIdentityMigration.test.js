const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '../sql/manual/022_contract_item_master_identity.sql'), 'utf8');

test('022 adds all three canonical Item Master levels without mutating legacy rows', () => {
  expect(sql).toContain('generic_item_id bigint REFERENCES public.generic_items');
  expect(sql).toContain('approved_product_id bigint REFERENCES public.approved_products');
  expect(sql).toContain('supplier_catalog_item_id bigint REFERENCES public.supplier_catalog_items');
  expect(sql).toContain('SQL_022_ALREADY_APPLIED_COMPATIBLE');
  expect(sql).toContain('SQL_022_PARTIAL_OR_DRIFTED_SCHEMA');
  expect(sql).not.toMatch(/UPDATE public\.contract_items/);
});

test('runtime Contract table definition includes canonical identity for clean databases', () => {
  const controller = fs.readFileSync(path.join(__dirname, '../controllers/contractsController.js'), 'utf8');
  for (const column of ['generic_item_id BIGINT', 'approved_product_id BIGINT', 'supplier_catalog_item_id BIGINT']) expect(controller).toContain(column);
  expect(controller).toContain('validateContractItemIdentity(client, b, contract, { required: true })');
});