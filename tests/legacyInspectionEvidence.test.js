jest.mock('../config/db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../utils/ensureTechnicalInspectionsTable', () => jest.fn().mockResolvedValue());
const pool = require('../config/db');
const controller = require('../controllers/technicalInspectionsController');
const router = require('../routes/technicalInspections');
const request = (body = {}, extra = {}) => ({ user: { id: 9, institute_id: 7, name: 'Inspector' }, params: { id: '61' }, body: { item_name: 'Historical device', ...body }, ...extra });
const response = () => { const res = { json: jest.fn(), send: jest.fn() }; res.status = jest.fn(() => res); return res; };
let state, statements, audits, failAudit, releaseLock;
beforeEach(() => {
  state = { id: 61, request_id: 41, requested_item_id: null, acceptance_status: 'pending', updated_at: '2026-10-01T00:00:00.000Z', summary: { additional_comments: 'Retained' }, created_by: 9 };
  statements = []; audits = []; failAudit = false; releaseLock = Promise.resolve();
  pool.query.mockImplementation(() => { throw new Error('Mutation escaped transaction'); });
  pool.connect.mockImplementation(async () => {
    let pending, audit, unlock, deleted = false;
    return { release: jest.fn(), query: jest.fn(async (sql, values = []) => {
      statements.push(sql);
      if (sql === 'BEGIN') return { rows: [] };
      if (sql === 'COMMIT') { if (pending) state = pending; if (deleted) state = null; if (audit) audits.push(audit); unlock?.(); return { rows: [] }; }
      if (sql === 'ROLLBACK') { unlock?.(); return { rows: [] }; }
      if (sql.includes('SELECT * FROM technical_inspections')) {
        const previous = releaseLock;
        releaseLock = new Promise(resolve => { unlock = resolve; });
        await previous;
        return { rows: [{ ...state }], rowCount: 1 };
      }
      if (sql.startsWith('SELECT id FROM requests')) return { rows: [{ id: 41 }], rowCount: 1 };
      if (sql.includes('INSERT INTO technical_inspections')) {
        pending = { ...state, request_id: values[16], acceptance_status: values[18], acceptance_recorded_by: values[20], acceptance_recorded_at: values[21] };
        return { rows: [pending], rowCount: 1 };
      }
      if (sql.includes('UPDATE technical_inspections')) {
        pending = { ...state, acceptance_status: values[16], acceptance_recorded_by: values[18], acceptance_recorded_at: values[19], updated_at: '2026-10-31T01:00:00.000Z' };
        return { rows: [pending], rowCount: 1 };
      }
      if (sql.startsWith('DELETE FROM technical_inspections')) { deleted = true; return { rowCount: 1 }; }
      if (sql.includes('INSERT INTO audit_logs')) {
        if (failAudit) throw new Error('Audit unavailable');
        audit = JSON.parse(values[5]); return { rows: [{ id: 1 }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }) };
  });
});
test('unauthorized inspector is denied before touching data', () => {
  const gate = router.stack.find(layer => layer.handle.name === 'requireTechnicalInspectionPermission').handle;
  const next = jest.fn(); gate(request({}, { user: { hasPermission: () => false } }), {}, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 })); expect(pool.connect).not.toHaveBeenCalled();
});
test.each(['Submitted','Rejected','Cancelled','Approved','On Hold','completed'])('accepted evidence cannot transition %s or close a case/PO', async status => {
  const res = response(), next = jest.fn();
  await controller.createTechnicalInspection(request({ request_id: 41, acceptance_status: 'passed' }), res, next);
  expect(next).not.toHaveBeenCalled(); expect(res.status).toHaveBeenCalledWith(201);
  expect(state).toMatchObject({ acceptance_status: 'passed', acceptance_recorded_by: 9 });
  expect(audits[0]).toMatchObject({ requestId: 41, instituteId: 7, metadata: { evidenceOnly: true, lifecycleEffect: 'none' } });
  // These controllers must not even address any lifecycle/fulfilment writer,
  // regardless of the linked request's current state or ordered quantity.
  expect(statements.every(sql => !/\b(?:UPDATE|INSERT INTO)\s+(?:requests|purchase_orders|procurement_cases|goods_receipt_items)\b/i.test(sql))).toBe(true);
});
test('pending edit preserves historical fields without a request writer', async () => {
  state.acceptance_status = 'passed'; const res = response(), next = jest.fn();
  await controller.updateTechnicalInspection(request({ acceptance_status: 'pending' }), res, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 61, request_id: 41, summary: { additional_comments: 'Retained' } }));
  expect(audits[0].beforeData.acceptance_status).toBe('passed'); expect(audits[0].afterData.acceptance_status).toBe('pending');
  expect(statements.filter(sql => /UPDATE requests/i.test(sql))).toEqual([]);
});
test.each(['createTechnicalInspection','updateTechnicalInspection'])('%s rolls back evidence when audit fails', async method => {
  failAudit = true; const before = { ...state }, next = jest.fn(), res = response();
  await controller[method](request({ request_id: 41, acceptance_status: 'passed' }), res, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Audit unavailable' }));
  expect(statements).toContain('ROLLBACK'); expect(statements).not.toContain('COMMIT');
  expect(state).toEqual(before); expect(audits).toEqual([]); expect(res.json).not.toHaveBeenCalled();
});
test('concurrent stale decisions serialize: one commit and one conflict', async () => {
  const token = state.updated_at, a = jest.fn(), b = jest.fn();
  await Promise.all([
    controller.updateTechnicalInspection(request({ acceptance_status: 'passed', expected_updated_at: token }), response(), a),
    controller.updateTechnicalInspection(request({ acceptance_status: 'failed', expected_updated_at: token }), response(), b),
  ]);
  expect(a).not.toHaveBeenCalled(); expect(b).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
  expect(state.acceptance_status).toBe('passed'); expect(audits).toHaveLength(1);
  expect(statements.filter(sql => sql === 'COMMIT')).toHaveLength(1);
});
test('legacy clients without a token retain serialized revision audits', async () => {
  await Promise.all([
    controller.updateTechnicalInspection(request({ acceptance_status: 'passed' }), response(), jest.fn()),
    controller.updateTechnicalInspection(request({ acceptance_status: 'failed' }), response(), jest.fn()),
  ]);
  expect(audits).toHaveLength(2); expect(audits[1].beforeData.acceptance_status).toBe('passed'); expect(audits[1].afterData.acceptance_status).toBe('failed');
});
test('foreign linked request is rejected transactionally before inspection creation', async () => {
  const client = { release: jest.fn(), query: jest.fn(async sql => {
    statements.push(sql);
    return { rows: [], rowCount: 0 };
  }) };
  pool.connect.mockResolvedValue(client);
  const next = jest.fn(), res = response();
  await controller.createTechnicalInspection(request({ request_id: 99, acceptance_status: 'passed' }), res, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('institute_id=$2 FOR SHARE'), [99, 7]);
  expect(statements).toContain('ROLLBACK'); expect(statements.some(sql => sql.includes('INSERT'))).toBe(false);
  expect(res.json).not.toHaveBeenCalled();
});

test('authorized legacy deletion retains before-image audit and never changes request status', async () => {
  const before = { ...state }, next = jest.fn(), res = response();
  await controller.deleteTechnicalInspection(request(), res, next);
  expect(next).not.toHaveBeenCalled(); expect(res.status).toHaveBeenCalledWith(204);
  expect(state).toBeNull(); expect(audits[0].beforeData).toEqual(before);
  expect(statements.some(sql => /UPDATE requests/i.test(sql))).toBe(false);
});
test('failed deletion audit leaves the historical record intact', async () => {
  failAudit = true; const before = { ...state }, next = jest.fn();
  await controller.deleteTechnicalInspection(request(), response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Audit unavailable' }));
  expect(state).toEqual(before); expect(statements).toContain('ROLLBACK');
  expect(statements.some(sql => sql.startsWith('DELETE'))).toBe(false);
});
