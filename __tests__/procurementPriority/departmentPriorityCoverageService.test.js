'use strict';

const {
  ensureRequestPriorityCoverage,
  ensureApprovedDepartmentPriorityCoverage,
} = require('../../services/procurementPriority/departmentPriorityCoverageService');

test('creates approval-pending cases and neutral profiles without overwriting existing coverage', async () => {
  const client = { query: jest.fn()
    .mockResolvedValueOnce({ rows: [{ id: 81 }] })
    .mockResolvedValueOnce({ rows: [] }) };

  await ensureRequestPriorityCoverage({
    client, requestId: 41, instituteId: 7, departmentId: 9, actorId: 12,
  });

  expect(client.query.mock.calls[0][0]).toContain("'APPROVAL_PENDING'");
  expect(client.query.mock.calls[0][0]).toContain('ON CONFLICT(requested_item_id)');
  expect(client.query.mock.calls[0][1]).toEqual([41, 7, 9, 12]);
  expect(client.query.mock.calls[1][0]).toContain("'NEEDS_ASSESSMENT'");
  expect(client.query.mock.calls[1][0]).toContain('ON CONFLICT(procurement_case_id) DO NOTHING');
});

test('backfills every request previously approved by a department HOD', async () => {
  const client = { query: jest.fn()
    .mockResolvedValueOnce({ rows: [{ id: 41 }, { id: 42 }] })
    .mockResolvedValue({ rows: [] }) };

  await ensureApprovedDepartmentPriorityCoverage({
    client, instituteId: 7, departmentId: 9, actorId: 12,
  });

  expect(client.query.mock.calls[0][0]).toContain("UPPER(approver.role)='HOD'");
  expect(client.query.mock.calls[0][1]).toEqual([7, 9]);
  expect(client.query.mock.calls[1][1]).toEqual([41, 7, 9, 12]);
  expect(client.query.mock.calls[3][1]).toEqual([42, 7, 9, 12]);
});