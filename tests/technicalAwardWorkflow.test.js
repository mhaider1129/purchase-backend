jest.mock('../config/db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../controllers/suppliersController', () => ({ ensureSuppliersTable: jest.fn() }));
jest.mock('../repositories/connectedP2PRepository', () => ({ createConnectedP2PRepository: jest.fn(), createTransactionalP2PRepository: jest.fn() }));
// Exercise the existing optional SQL 049 workflow without installing SQL 054.
// Profile loading/evidence-retention are infrastructure seams, not approval gates.
jest.mock('../services/technicalReviewProfiles', () => ({
  ...jest.requireActual('../services/technicalReviewProfiles'),
  installed: async () => false, forItems: async () => new Map(), retainEvidence: async () => {},
}));
const pool = require('../config/db');
const { createConnectedP2PRepository, createTransactionalP2PRepository } = require('../repositories/connectedP2PRepository');
const buildFixture = require('./helpers/technicalAwardFixture');
const fixture = (...args) => { const h = buildFixture(...args); createTransactionalP2PRepository.mockReturnValue(h.repository); return h; };
const { submitLinkedRfxResponse } = require('../services/rfxResponseService');
const { createTechnicalReviewService } = require('../services/preprocurementTechnicalReviewService');
const { awardRfxResponse } = require('../controllers/rfxPortalController');
const poService = require('../services/purchaseOrderService');
const p2p = require('../controllers/procureToPayController');
const res = () => ({ json: jest.fn() });
async function approvedProposal(h) {
  // 1: canonical supplier quotation persistence (actual line normalization).
  await h.repository.withTransaction(repository => submitLinkedRfxResponse({ repository, event: h.state.event, supplierId: 3, submittedBy: h.scm.id, notes: 'Supplier proposal', responseData: { manufacturer: 'Maker', model: 'Model A' }, lines: [{ requested_item_id: 4, quoted_quantity: '2', unit_price: '5', currency: 'IQD', offered_specs: 'Specification A', ...(h.state.item.generic_item_id ? { approved_product_id: 71, supplier_catalog_item_id: 72 } : {}) }] }));
  const service = createTechnicalReviewService(h.database);
  // 2: SCM requests technical opinion on exact persisted quotation and evidence.
  let review = await service.create(h.scm, { request_id: 2, submission_key: 'review-1', instructions: 'Assess offered device and specification', reviewer_ids: [10], items: [{ item_id: 4, evidence: { basis: 'data_sheet', category: 'Device', quotation_item_id: 21, no_sample_reason: 'Sample unavailable; assess attached sheet', evidence_description: 'Supplier Model A', attachment_ids: [8] } }] });
  // 3: independent departmental reviewer attests technical suitability.
  review = await service.opinion(h.reviewer, review.id, { row_version: review.row_version, reports: [{ item_id: 4, assessment_version: 2, assessment: { specifications: 'compliant', compatibility: 'compatible', suitability: 'suitable' }, decision: 'APPROVED', findings: 'Meets clinical requirements' }] });
  // 4: distinct SCM signatory completes clearance.
  review = await service.sign(h.scm, review.id, { row_version: review.row_version, decision: 'APPROVED', notes: 'Independent opinion verified' });
  return { service, review };
}
async function award(h, actor = h.scm) {
  const response = res(), next = jest.fn();
  // 5/6: actual RFx award controller composes real award and PO-create services,
  // then changes response status to awarded in the same simulated transaction.
  await awardRfxResponse({ params: { id: '1' }, body: { response_id: 20 }, user: actor }, response, next);
  return { response, next };
}
async function approvePo(h) {
  await poService.submitPurchaseOrder({ repository: h.repository, purchaseOrderId: 41, actor: h.scm });
  // 7: use real permission-gated approval controller and canonical PO service.
  const response = res(), next = jest.fn();
  await p2p.approvePurchaseOrder({ params: { poId: '41' }, user: h.scm }, response, next);
  expect(next).not.toHaveBeenCalled(); expect(h.state.po.status).toBe('PO_APPROVED');
}
beforeEach(() => jest.clearAllMocks());
test('quotation → departmental approval → SCM sign-off → RFx award → approved PO → issued PO', async () => {
  const h = fixture(pool, createConnectedP2PRepository);
  const { review } = await approvedProposal(h);
  const evidence = structuredClone(review.item_packets);
  const result = await award(h); expect(result.next).not.toHaveBeenCalled();
  expect(h.state.response.status).toBe('awarded'); expect(h.state.awards).toHaveLength(1);
  expect(h.state.lines[0]).toMatchObject({ award_id: 31, price_source_type: 'QUOTATION', price_source_id: '21', source_uom: 'Piece', unit_price: '5.0000' });
  expect(h.state.links).toContainEqual([2, 'TECHNICAL_REVIEW', 51, 'PURCHASE_ORDER', 41, 9]);
  expect(h.state.audits.find(a => a.action === 'PO_CREATED').metadata.technical_clearances[0]).toMatchObject({ review_id: 51, round_version: 3, signed_by: 9, quotation_item_id: '21', quotation_fingerprint_version: 2 });
  await approvePo(h);
  // 8: actual issue controller keeps the technical gate and budget commitment.
  const response = res(), next = jest.fn();
  await p2p.issuePurchaseOrder({ params: { poId: '41' }, user: h.scm }, response, next);
  expect(next).not.toHaveBeenCalled(); expect(h.state.po.status).toBe('PO_ISSUED');
  expect(h.state.commitments).toHaveLength(1); expect(h.state.review.item_packets).toEqual(evidence);
  expect(h.state.assignments[0].submitted_by).toBe(10); expect(h.state.review.signed_at).toBeTruthy();
  expect(h.state.audits.filter(a => a.action === 'TECHNICAL_REVIEW_SIGNED')).toHaveLength(1);
  // Identical issue retry is exact-once, not a second budget or audit operation.
  await p2p.issuePurchaseOrder({ params: { poId: '41' }, user: h.scm }, res(), next);
  expect(next).not.toHaveBeenCalled(); expect(h.state.commitments).toHaveLength(1);
  expect(h.state.audits.filter(a => a.action === 'PO_ISSUED')).toHaveLength(1);
});
test('concurrent award retries create one award and PO', async () => {
  const h = fixture(pool, createConnectedP2PRepository); await approvedProposal(h);
  const results = await Promise.all([award(h), award(h)]);
  results.forEach(r => expect(r.next).not.toHaveBeenCalled());
  expect(h.state.awards).toHaveLength(1); expect(h.state.lines).toHaveLength(1);
  expect(results.some(r => r.response.json.mock.calls[0][0].idempotent)).toBe(true);
});
test('material revision after award blocks PO issue and leaves budget unchanged', async () => {
  const h = fixture(pool, createConnectedP2PRepository); await approvedProposal(h); await award(h); await approvePo(h);
  h.state.quote.offered_specs = 'Unreviewed specification';
  await expect(poService.releasePurchaseOrder({ repository: h.repository, purchaseOrderId: 41, actor: h.scm })).rejects.toMatchObject({ code: 'TECHNICAL_PROPOSAL_CHANGED' });
  expect(h.state.po.status).toBe('PO_APPROVED'); expect(h.state.commitments).toHaveLength(0);
});
test('replaced review round or missing PO provenance cannot silently clear an existing PO', async () => {
  const h = fixture(pool, createConnectedP2PRepository); await approvedProposal(h); await award(h); await approvePo(h);
  h.state.review.id = 99;
  await expect(poService.releasePurchaseOrder({ repository: h.repository, purchaseOrderId: 41, actor: h.scm })).rejects.toMatchObject({ code: 'TECHNICAL_PROPOSAL_REVIEW_REQUIRED' });
  expect(h.state.commitments).toHaveLength(0);
});
test('unauthorized actor cannot award or issue', async () => {
  const h = fixture(pool, createConnectedP2PRepository); await approvedProposal(h);
  const outsider = { id: 22, institute_id: 7, role: 'Requester', hasPermission: () => false };
  expect((await award(h, outsider)).next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  const next = jest.fn(); await p2p.issuePurchaseOrder({ params: { poId: '41' }, user: outsider }, res(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 })); expect(h.state.awards).toHaveLength(0);
});
test('foreign institute cannot reuse technically cleared proposal', async () => {
  const h = fixture(pool, createConnectedP2PRepository); await approvedProposal(h);
  const result = await award(h, { ...h.scm, institute_id: 8 });
  expect(result.next).toHaveBeenCalledWith(expect.objectContaining({ code: 'TECHNICAL_REVIEW_SCOPE_DENIED' })); expect(h.state.awards).toHaveLength(0);
});
test('award/PO/technical provenance roll back together when audit fails', async () => {
  const h = fixture(pool, createConnectedP2PRepository); await approvedProposal(h);
  h.failAudit = 'PO_CREATED'; const result = await award(h);
  expect(result.next).toHaveBeenCalled(); expect(h.state.awards).toHaveLength(0); expect(h.state.po).toBeNull(); expect(h.state.links).toHaveLength(0);
  expect(h.state.response.status).toBe('submitted'); expect(h.state.review.status).toBe('APPROVED');
});

test('PO issuance rolls back budget, status and audit when the issue event fails', async () => {
  const h = fixture(pool, createConnectedP2PRepository); await approvedProposal(h); await award(h); await approvePo(h);
  h.failAudit = 'PO_ISSUED';
  await expect(poService.releasePurchaseOrder({ repository: h.repository, purchaseOrderId: 41, actor: h.scm })).rejects.toThrow('Injected audit failure');
  expect(h.state.po.status).toBe('PO_APPROVED'); expect(h.state.commitments).toHaveLength(0);
  expect(h.state.audits.filter(a => ['PO_ISSUED','BUDGET_COMMITTED'].includes(a.action))).toHaveLength(0);
});
test('SCM cannot select themselves as independent technical reviewer', async () => {
  const h = fixture(pool, createConnectedP2PRepository), service = createTechnicalReviewService(h.database);
  await expect(service.create(h.scm, { request_id: 2, reviewer_ids: [h.scm.id], items: [{ item_id: 4 }] })).rejects.toMatchObject({ statusCode: 400 });
  expect(h.state.review).toBeNull();
});

test('governed Product/Catalog proposal retains exact product and UOM provenance through issue', async () => {
  const h = fixture(pool, createConnectedP2PRepository);
  Object.assign(h.state.item, { request_mode: 'generic_item', catalog_status: 'catalogued', generic_item_id: 70, unit_of_measure: 'BOX' });
  h.state.product = { id: 71, generic_item_id: 70, manufacturer_id: 73, manufacturer_part_number: 'Model A', product_name: 'Device A', package_quantity: '2' };
  h.state.catalog = { id: 72, supplier_id: 3, approved_product_id: 71, purchasing_uom_id: 5, conversion_factor: '1' };
  const { review } = await approvedProposal(h);
  expect(review.item_packets[0].evidence).toMatchObject({ approved_product_id: '71', model_number: 'Model A' });
  const result = await award(h); expect(result.next).not.toHaveBeenCalled(); await approvePo(h);
  await poService.releasePurchaseOrder({ repository: h.repository, purchaseOrderId: 41, actor: h.scm });
  expect(h.state.po.status).toBe('PO_ISSUED');
  expect(h.state.lines[0]).toMatchObject({ approved_product_id: 71, supplier_catalog_item_id: 72, generic_item_id: 70, source_uom_id: 5, base_uom_id: 1, conversion_factor: '2' });
});
test('an APPROVED label without signed approval evidence is insufficient', async () => {
  const h = fixture(pool, createConnectedP2PRepository); await approvedProposal(h);
  h.state.review.signed_at = null;
  const result = await award(h);
  expect(result.next).toHaveBeenCalledWith(expect.objectContaining({ code: 'TECHNICAL_PROPOSAL_REVIEW_REQUIRED' }));
  expect(h.state.awards).toHaveLength(0); expect(h.state.po).toBeNull();
});
