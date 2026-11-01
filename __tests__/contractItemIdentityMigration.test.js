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

test('manual schema installs canonical identity and runtime uses the canonical validator', () => {
  const controller = fs.readFileSync(path.join(__dirname, '../controllers/contractsController.js'), 'utf8');
  const schema=fs.readFileSync(path.join(__dirname,'../sql/manual/059_backend_contract_refresh.sql'),'utf8');
  for (const column of ['generic_item_id','approved_product_id','supplier_catalog_item_id']) expect(schema).toContain(column);
  expect(controller).toContain('const ensureContractsTable = contractBoundary.ensureSchema');
  expect(controller).toContain('validateContractItemIdentity(client, b, contract, { required: true })');
});