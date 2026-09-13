const { validateContractItemIdentity } = require('../services/contractItemIdentityService');

const contract = { id: 4, supplier_id: 12 };
const client = rows => ({ query: jest.fn()
  .mockResolvedValueOnce({ rows: [rows.generic] })
  .mockResolvedValueOnce({ rows: rows.product ? [rows.product] : [] })
  .mockResolvedValueOnce({ rows: rows.catalog ? [rows.catalog] : [] }) });

test('resolves a complete canonical Generic, Product and Supplier Catalog chain', async () => {
  const db = client({ generic: { id: 1, generic_name: 'Seal kit', is_active: true }, product: { id: 2, generic_item_id: 1, product_name: 'OEM Seal Kit', approval_status: 'approved', is_active: true }, catalog: { id: 3, approved_product_id: 2, supplier_id: 12, is_active: true, is_approved_supplier: true } });
  await expect(validateContractItemIdentity(db, { generic_item_id: 1, approved_product_id: 2, supplier_catalog_item_id: 3 }, contract, { required: true })).resolves.toEqual({ generic_item_id: 1, approved_product_id: 2, supplier_catalog_item_id: 3, item_name: 'OEM Seal Kit' });
});

test('new Contract lines require at least canonical Generic identity', async () => {
  await expect(validateContractItemIdentity({ query: jest.fn() }, { item_name: 'free text' }, contract, { required: true })).rejects.toMatchObject({ statusCode: 400 });
});

test('rejects Product outside the selected Generic', async () => {
  const db = client({ generic: { id: 1, is_active: true }, product: { id: 2, generic_item_id: 9, approval_status: 'approved', is_active: true } });
  await expect(validateContractItemIdentity(db, { generic_item_id: 1, approved_product_id: 2 }, contract, { required: true })).rejects.toMatchObject({ statusCode: 400 });
});

test('rejects Catalog identity from a different Contract supplier', async () => {
  const db = client({ generic: { id: 1, is_active: true }, product: { id: 2, generic_item_id: 1, approval_status: 'approved', is_active: true }, catalog: { id: 3, approved_product_id: 2, supplier_id: 99, is_active: true, is_approved_supplier: true } });
  await expect(validateContractItemIdentity(db, { generic_item_id: 1, approved_product_id: 2, supplier_catalog_item_id: 3 }, contract, { required: true })).rejects.toMatchObject({ statusCode: 400 });
});

test('rejects unapproved Product and Catalog records', async () => {
  const productDb = client({ generic: { id: 1, is_active: true }, product: { id: 2, generic_item_id: 1, approval_status: 'pending', is_active: true } });
  await expect(validateContractItemIdentity(productDb, { generic_item_id: 1, approved_product_id: 2 }, contract, { required: true })).rejects.toMatchObject({ statusCode: 400 });
});

test('rejects a Stock Item mapped to a different Generic Item', async () => {
  const db = { query: jest.fn()
    .mockResolvedValueOnce({ rows: [{ id: 1, generic_name: 'Seal', is_active: true }] })
    .mockResolvedValueOnce({ rows: [{ id: 7, generic_item_id: 9, approved_product_id: null }] }) };
  await expect(validateContractItemIdentity(db, { generic_item_id: 1, item_id: 7 }, contract, { required: true })).rejects.toMatchObject({ statusCode: 400 });
});