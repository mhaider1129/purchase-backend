const { prepare, assertCurrent } = require('../services/technicalProposalSnapshot');
const { fingerprint } = require('../services/preprocurementTechnicalReviewModel');
function fixture() {
  const quote = { id: 21, rfx_response_id: 20, requested_item_id: 4, supplier_id: 3, quoted_quantity: '2.0000', free_quantity: '0.0000', unit_price: '5.0000', currency: 'IQD', brand: 'A', offered_specs: 'Model A, sterile', notes: 'Approved alternative A only', response_status: 'submitted', response_notes: 'Delivery terms', response_request_id: 2, response_bid_amount: '10', response_data: { manufacturer: 'Maker', attachments: [{ revision: 1, key: 'quote-v1.pdf' }] }, created_at: '2026-10-01' };
  const files = [{ id: 8, request_id: 2, file_path: 'evidence-v1.pdf', file_name: 'specification.pdf' }];
  const db = { query: jest.fn(async sql => {
    if (sql.includes('required.table_name')) return { rows: [] };
    if (sql.includes('FROM rfx_response_items')) return { rows: [{ ...quote }] };
    if (sql.includes('FROM suppliers')) return { rows: [{ id: 3, name: 'Supplier' }] };
    if (sql.includes('FROM attachments')) return { rows: files.map(attachment => ({ attachment })) };
    throw new Error(`Unexpected query ${sql}`);
  }) };
  const evidence = { quotation_item_id: '21', attachment_ids: [8] };
  const context = { supplier_id: 3, source_type: 'QUOTATION', source_id: 21, unit_price: '5', currency: 'IQD', quantity: '2' };
  return { quote, files, db, evidence, context };
}
test.each(['submitted','evaluated','awarded','po_created'])('unchanged %s transition preserves content approval', async status => {
  const h = fixture(); await prepare(h.db, { institute_id: 7 }, h.evidence, 4);
  const signed = structuredClone(h.evidence);
  h.quote.response_status = status; h.quote.updated_at = 'later';
  await expect(assertCurrent(h.db, h.evidence, h.context)).resolves.toBeUndefined();
  expect(h.evidence).toEqual(signed); expect(h.evidence.quotation_fingerprint_version).toBe(2);
});
test.each([
  ['supplier replacement', q => q.supplier_id = 99],
  ['product change', q => q.approved_product_id = 99],
  ['specifications', q => q.offered_specs = 'Changed'],
  ['quantity', q => q.quoted_quantity = '3.0000'],
  ['free quantity', q => q.free_quantity = '1.0000'],
  ['price', q => q.unit_price = '6.0000'],
  ['currency', q => q.currency = 'USD'],
  ['manufacturer', q => q.response_data.manufacturer = 'Other maker'],
  ['model', q => q.response_data.model = 'Replacement model'],
  ['alternative', q => q.notes = 'Alternative B'],
  ['quote attachment revision', q => q.response_data.attachments[0].revision = 2],
  ['quotation identity', q => q.id = 99],
])('%s invalidates unchanged-source approval', async (_label, change) => {
  const h = fixture(); await prepare(h.db, { institute_id: 7 }, h.evidence, 4); change(h.quote);
  await expect(assertCurrent(h.db, h.evidence, h.context)).rejects.toMatchObject({ code: 'TECHNICAL_PROPOSAL_CHANGED' });
});
test('selected evidence replacement or deletion invalidates clearance', async () => {
  const h = fixture(); await prepare(h.db, { institute_id: 7 }, h.evidence, 4);
  h.files[0].file_path = 'new-specification.pdf';
  await expect(assertCurrent(h.db, h.evidence, h.context)).rejects.toMatchObject({ code: 'TECHNICAL_PROPOSAL_CHANGED' });
  h.files.length = 0;
  await expect(assertCurrent(h.db, h.evidence, h.context)).rejects.toMatchObject({ code: 'TECHNICAL_PROPOSAL_CHANGED' });
});
test('JSONB key ordering is not a technical revision', async () => {
  const h = fixture(); await prepare(h.db, { institute_id: 7 }, h.evidence, 4);
  h.quote.response_data = { attachments: [{ key: 'quote-v1.pdf', revision: 1 }], manufacturer: 'Maker' };
  await expect(assertCurrent(h.db, h.evidence, h.context)).resolves.toBeUndefined();
});
test('legacy hash verifies only under its original format; workflow changes require explicit re-review', async () => {
  const h = fixture(); h.evidence.quotation_fingerprint = fingerprint(h.quote);
  await expect(assertCurrent(h.db, h.evidence, h.context)).resolves.toBeUndefined();
  h.quote.response_status = 'awarded';
  await expect(assertCurrent(h.db, h.evidence, h.context)).rejects.toMatchObject({ code: 'TECHNICAL_PROPOSAL_REVIEW_REQUIRED' });
  expect(h.evidence.quotation_fingerprint_version).toBeUndefined();
});
test('unknown or missing fingerprint formats fail closed', async () => {
  const h = fixture(); h.evidence.quotation_fingerprint_version = 99;
  await expect(assertCurrent(h.db, h.evidence, h.context)).rejects.toMatchObject({ code: 'TECHNICAL_PROPOSAL_REVIEW_REQUIRED' });
  delete h.evidence.quotation_fingerprint_version;
  await expect(assertCurrent(h.db, h.evidence, h.context)).rejects.toMatchObject({ code: 'TECHNICAL_PROPOSAL_REVIEW_REQUIRED' });
});
test.each([{ unit_price: '1' }, { currency: 'USD' }, { quantity: '3' }])('award/PO cannot substitute terms: %j', async override => {
  const h = fixture(); await prepare(h.db, { institute_id: 7 }, h.evidence, 4);
  await expect(assertCurrent(h.db, h.evidence, { ...h.context, ...override })).rejects.toMatchObject({ code: 'TECHNICAL_PROPOSAL_CHANGED' });
});
test.each(['purchasing_uom_id', 'conversion_factor'])('supplier catalog %s change invalidates quotation approval', async field => {
  const h = fixture(), catalog = { id: 44, supplier_id: 3, approved_product_id: null, purchasing_uom_id: 5, conversion_factor: '1' };
  h.quote.supplier_catalog_item_id = 44;
  const original = h.db.query.getMockImplementation();
  h.db.query.mockImplementation(async (sql,p) => sql.includes('to_jsonb(c) AS catalog') ? { rows: [{ catalog: { ...catalog } }] } : original(sql,p));
  await prepare(h.db, { institute_id: 7 }, h.evidence, 4);
  catalog[field] = field === 'purchasing_uom_id' ? 6 : '2';
  await expect(assertCurrent(h.db, h.evidence, h.context)).rejects.toMatchObject({ code: 'TECHNICAL_PROPOSAL_CHANGED' });
});
test.each(['withdrawn','cancelled','closed','superseded','rejected'])('%s quotation is not eligible merely because content is unchanged', async status => {
  const h = fixture(); await prepare(h.db, { institute_id: 7 }, h.evidence, 4); h.quote.response_status = status;
  await expect(assertCurrent(h.db, h.evidence, h.context)).rejects.toMatchObject({ code: 'TECHNICAL_PROPOSAL_CHANGED' });
});
test('awarding a different catalog offer cannot reuse the reviewed quotation', async () => {
  const h = fixture(); await prepare(h.db, { institute_id: 7 }, h.evidence, 4);
  await expect(assertCurrent(h.db, h.evidence, { ...h.context, supplier_catalog_item_id: 99 })).rejects.toMatchObject({ code: 'TECHNICAL_PROPOSAL_CHANGED' });
});
test('a partial PO allocation within the reviewed payable quantity is legitimate', async () => {
  const h = fixture(); await prepare(h.db, { institute_id: 7 }, h.evidence, 4);
  await expect(assertCurrent(h.db, h.evidence, { ...h.context, quantity: '1' })).resolves.toBeUndefined();
});
