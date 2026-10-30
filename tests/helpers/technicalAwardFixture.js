// In-memory SQL/repository boundary; no PostgreSQL or hosted services. Production
// technical/RFx/award/PO services run unchanged. BEGIN simulates serial row locks.
function fixture(pool, repositoryFactory) {
  const clone = value => structuredClone(value);
  const scm = { id: 9, institute_id: 7, department_id: 12, role: 'SCM', hasPermission: () => true };
  const reviewer = { id: 10, institute_id: 7, department_id: 11, role: 'HOD', hasPermission: () => false };
  let state = {
    request: { id: 2, institute_id: 7, department_id: 11, request_type: 'Non-Stock', status: 'Approved' },
    item: { id: 4, request_id: 2, item_name: 'Approved non-stock device', quantity: '2', specs: 'Specification A', unit_of_measure: 'Piece', approval_status: 'Approved', request_mode: 'approved_free_text_exception', catalog_status: 'approved_exception', restriction_justification: 'Approved steward exception' },
    event: { id: 1, request_id: 2, status: 'open' }, response: null, quote: null,
    review: null, assignments: [], awards: [], po: null, lines: [], links: [], audits: [], outbox: [], commitments: [],
    files: [{ id: 8, request_id: 2, file_name: 'Specification A', file_path: 'spec-v1.pdf' }],
  };
  let queue = Promise.resolve(), failAudit = false;
  const rows = values => ({ rows: clone(values), rowCount: values.length });
  const query = async (raw, p = []) => {
    const sql = raw.replace(/\s+/g, ' ').trim();
    if (/^(CREATE|ALTER)\b/.test(sql)) return rows([]); // existing initializers, never executed on a DB
    if (sql.includes('required.table_name')) return rows([]);
    if (sql.includes('technical_review_available')) return rows([{ technical_review_available: true }]);
    if (sql.includes('AS available')) return rows([{ available: true }]);
    if (sql.includes('pg_advisory_xact_lock')) return rows([]);
    if (sql.includes('FROM rfx_response_items q')) return rows(state.quote ? [{ ...state.quote, supplier_id: state.response.supplier_id, response_status: state.response.status, response_notes: state.response.notes, response_data: state.response.response_data, response_bid_amount: state.response.bid_amount, response_request_id: state.response.request_id }] : []);
    if (sql.includes('FROM approved_products')) return rows(state.product ? [{ product: state.product, manufacturer: 'Maker' }] : []);
    if (sql.includes('FROM supplier_catalog_items')) return rows(state.catalog ? [{ catalog: state.catalog }] : []);
    if (sql.startsWith('SELECT generic_item_id FROM requested_items')) return rows([{ generic_item_id: state.item.generic_item_id }]);
    if (sql.includes('FROM suppliers')) return rows([{ id: 3, name: 'Supplier A', status: 'active' }]);
    if (sql.includes('to_jsonb(a) AS attachment')) return rows(state.files.filter(f => p[0].map(String).includes(String(f.id))).map(attachment => ({ attachment })));
    if (sql.includes('FROM public.attachments')) return rows(state.files.filter(f => p[1].map(String).includes(String(f.id))));
    if (sql.includes('FROM public.requests r JOIN public.departments')) return rows(Number(p[1]) === state.request.institute_id ? [state.request] : []);
    if (sql.startsWith('SELECT department_id FROM public.requests')) return rows(Number(p[1]) === state.request.institute_id ? [state.request] : []);
    if (sql.includes('SELECT ri.*,r.institute_id')) return rows([{ ...state.item, institute_id: state.request.institute_id, requesting_department_id: state.request.department_id, request_type: state.request.request_type, request_status: state.request.status }]);
    if (sql.includes('SELECT require_for_all')) return rows([{ require_for_all: false }]);
    if (sql.includes('SELECT id,status,item_packets')) return rows(state.review ? [state.review] : []);
    if (sql.startsWith('SELECT id,payload_fingerprint')) return rows(state.review?.submission_key === p[1] ? [state.review] : []);
    if (sql.startsWith('SELECT id FROM public.preprocurement_technical_reviews')) return rows(state.review?.status === 'IN_REVIEW' ? [state.review] : []);
    if (sql.startsWith('SELECT u.id,u.department_id')) return rows(p[0].map(Number).includes(reviewer.id) ? [{ id: reviewer.id, department_id: reviewer.department_id }] : []);
    if (/SELECT \* FROM (?:public\.)?requested_items/.test(sql)) return rows([state.item]);
    if (sql.startsWith('INSERT INTO public.preprocurement_technical_reviews')) {
      state.review = { id: 51, institute_id: p[0], request_id: p[1], requesting_department_id: p[2], item_packets: JSON.parse(p[3]), instructions: p[4], submission_key: p[5], payload_fingerprint: p[6], created_by: p[7], row_version: 1, status: 'IN_REVIEW' }; return rows([{ id: 51 }]);
    }
    if (sql.startsWith('INSERT INTO public.preprocurement_technical_review_assignments')) { state.assignments.push({ id: 52, review_id: p[0], department_id: p[1], reviewer_id: p[2], status: 'PENDING' }); return rows([]); }
    if (sql.startsWith('SELECT t.*,r.maintenance_ref_number')) {
      const allowed = state.review && Number(p[1]) === state.review.institute_id && (p[2] || state.assignments.some(a => a.reviewer_id === p[3]));
      return rows(allowed ? [state.review] : []);
    }
    if (sql.includes('SELECT a.*,u.name AS reviewer_name')) return rows(state.assignments);
    if (sql.startsWith('UPDATE public.preprocurement_technical_review_assignments a')) {
      const a = state.assignments.find(a => a.id === p[2] && a.reviewer_id === p[3]);
      if (!a || Number(p[4]) !== reviewer.institute_id) return rows([]);
      Object.assign(a, { status: p[0], reports: JSON.parse(p[1]), submitted_by: p[3], submitted_at: '2026-10-31T10:00:00Z' }); return rows([a]);
    }
    if (sql.startsWith('UPDATE public.preprocurement_technical_reviews SET row_version')) { state.review.row_version++; return rows([]); }
    if (sql.startsWith('UPDATE public.preprocurement_technical_reviews t SET status')) { Object.assign(state.review, { status: p[0], signed_by: p[3], signed_at: '2026-10-31T11:00:00Z', row_version: state.review.row_version + 1 }); return rows([state.review]); }
    if (sql.startsWith('INSERT INTO audit_logs')) { if (failAudit === true || failAudit === p[0]) throw Error('Injected audit failure'); state.audits.push({ action: p[0], entity_id: p[3], ...JSON.parse(p[5]) }); return rows([{ id: state.audits.length }]); }
    if (sql.startsWith('INSERT INTO notification_outbox')) { state.outbox.push({ event_type: p[0], idempotency_key: p[5] }); return rows([{ id: state.outbox.length }]); }
    if (sql.startsWith('INSERT INTO public.notifications') || sql.startsWith('INSERT INTO request_logs')) return rows([{ id: 1 }]);
    if (sql.startsWith('SELECT resp.id')) return rows([{ ...state.response, response_status: state.response.status, event_status: state.event.status, event_request_id: 2 }]);
    if (sql.startsWith('SELECT id, status, sourcing_status')) return rows([state.request]);
    if (sql.startsWith('SELECT * FROM purchase_orders WHERE rfx_id')) return rows(state.po?.rfx_response_id === p[1] ? [state.po] : []);
    if (sql.startsWith('SELECT * FROM rfx_response_items')) return rows([state.quote]);
    if (sql.startsWith('SELECT po.* FROM purchase_orders')) return rows(state.po && state.po.rfx_response_id !== p[1] ? [state.po] : []);
    if (sql.startsWith('UPDATE rfx_responses')) { state.response.status = 'awarded'; return rows([]); }
    if (sql.startsWith('UPDATE rfx_events')) { state.event.status = 'awarded'; return rows([]); }
    if (sql.startsWith('UPDATE requests SET awarded_supplier_id')) { state.request.purchase_order_id = p[3]; return rows([state.request]); }
    if (sql.includes('FROM document_flow_links')) return rows(state.links.filter(l => l[0] === p[0] && String(l[2]) === p[1] && l[3] === 'PURCHASE_ORDER' && String(l[4]) === p[2]));
    throw Error(`Unhandled fixture SQL: ${sql}`);
  };
  const connect = async () => {
    let unlock, before;
    return { release() {}, query: async (sql, p) => {
      if (sql === 'BEGIN') { const prior = queue; queue = new Promise(resolve => { unlock = resolve; }); await prior; before = clone(state); return rows([]); }
      if (sql === 'COMMIT') { unlock?.(); return rows([]); }
      if (sql === 'ROLLBACK') { state = before; unlock?.(); return rows([]); }
      return query(sql, p);
    } };
  };
  const makeRepo = client => {
    const tx = {
      client, withTransaction: work => work(tx),
      loadRequestedItems: async () => [clone(state.item)],
      insertResponse: async x => { state.response = { id: 20, status: 'submitted', ...x }; return clone(state.response); },
      insertResponseItem: async x => { state.quote = { id: 21, ...x }; return clone(state.quote); },
      lockRequestItem: async () => clone(state.item),
      assertOfferIdentity: async () => ({ purchasing_uom_id: 5, uom_active: true, conversion_factor: '1', package_quantity: '2' }),
      loadAwardCatalogIdentity: async () => ({ ...clone(state.catalog), catalog_active: true, approval_status: 'approved', product_active: true, lifecycle_status: 'active', generic_active: true, generic_item_id: 70, uom_active: true, package_quantity: '2' }),
      loadAwardUomSnapshot: async () => ({ ...clone(state.item), source_uom_id: 5, source_uom: 'BOX', generic_base_uom_id: 1, inventory_uom_id: 1, base_uom_id: 1, base_uom: 'EA', supplier_conversion_factor: '1', package_quantity: '2' }),
      loadSupplierEligibilityFacts: async () => ({ supplier: { id: 3, status: 'active' } }),
      findByIdempotencyKey: async key => state.awards.find(a => a.idempotency_key === key),
      sumActiveAwards: async () => String(state.awards.reduce((sum,a) => sum + Number(a.awarded_quantity), 0)),
      insert: async x => { const a = { id: 31, status: 'ACTIVE', ...x }; state.awards.push(a); return clone(a); },
      lockAwards: async () => clone(state.awards),
      getAwardConversion: async () => ({ remaining_quantity: state.po ? '0' : '2' }),
      loadAwardExceptionSnapshot: async () => ({ ...clone(state.item), source_uom: state.item.unit_of_measure, base_uom: state.item.unit_of_measure, conversion_factor: '1' }),
      nextPurchaseOrderNumber: async () => ({ po_number: 'PO-2026-000001' }), findPurchaseOrderByNumber: async () => null,
      insertHeader: async x => { state.po = { id: 41, ...x }; return clone(state.po); },
      insertLine: async x => { const l = { id: 42, ...x }; state.lines.push(l); return clone(l); },
      linkDocuments: async (...args) => { state.links.push(args); },
      lockPurchaseOrder: async () => clone(state.po), loadPurchaseOrder: async () => ({ ...clone(state.po), lines: clone(state.lines) }), loadPurchaseOrderLines: async () => clone(state.lines),
      markPurchaseOrderSubmitted: async () => { state.po.status = 'PO_PENDING_APPROVAL'; return clone(state.po); },
      markPurchaseOrderApproved: async (_id,id) => { Object.assign(state.po, { status: 'PO_APPROVED', approved_by: id, approved_at: '2026-10-31T12:00:00Z' }); return clone(state.po); },
      findCommitmentByIdempotency: async key => state.commitments.find(c => c.idempotency_key === key),
      resolveBudgetEnvelope: async () => ({ id: 1 }), lockBudgetEnvelope: async () => ({ id: 1, allocated_amount: '100', consumed_amount: '0' }), sumActiveEncumbrances: async () => '0',
      insertEncumbrance: async x => { const c = { id: 61, ...x }; state.commitments.push(c); return clone(c); },
      markPurchaseOrderIssued: async (_id,totals,actorId) => { Object.assign(state.po, { status: 'PO_ISSUED', issued_by: actorId, ...totals }); return clone(state.po); },
    }; return tx;
  };
  pool.query.mockImplementation(query); pool.connect.mockImplementation(connect);
  repositoryFactory.mockImplementation(makeRepo);
  const repository = { withTransaction: async work => { const c = await connect(); await c.query('BEGIN'); try { const result = await work(makeRepo(c)); await c.query('COMMIT'); return result; } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } } };
  return { scm, reviewer, repository, database: { query, connect }, get state() { return state; }, set failAudit(value) { failAudit = value; } };
}
module.exports = fixture;
