'use strict';

jest.mock('../../services/auditService', () => ({ writeAuditEvent: jest.fn() }));
const { writeAuditEvent } = require('../../services/auditService');
const { findGate, auditGate, STATE, INSTRUCTION } = require('../../services/procurementPriority/hodRankingGateService');

const request = { id: 41, institute_id: 7, department_id: 9 };

test('HOD approval without an active unranked priority case continues normally', async () => {
  const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
  await expect(findGate({ client, request, approvalLevel: 2 })).resolves.toBeNull();
  expect(client.query).toHaveBeenCalledTimes(1);
});

test('one unranked case produces the controlled ranking representation', async () => {
  const item = { procurement_case_id: 101, public_title: 'Sterile supplies', row_version: 0, department_rank: null };
  const client = { query: jest.fn().mockResolvedValueOnce({ rows: [item] }).mockResolvedValueOnce({ rows: [item] }) };
  const gate = await findGate({ client, request, approvalLevel: 2 });
  expect(gate).toMatchObject({ state: STATE, instruction: INSTRUCTION, requestId: 41, approvalLevel: 2, requiredCaseIds: [101] });
});

test('active case with a missing profile provisions neutral coverage then requires ranking', async () => {
  const item = { procurement_case_id: 101, institute_id: 7, department_id: 9, row_version: null, department_rank: null };
  const client = { query: jest.fn().mockResolvedValueOnce({ rows: [item] })
    .mockResolvedValueOnce({ rows: [{ procurement_case_id: 101, coverage_status: 'NEEDS_ASSESSMENT' }] })
    .mockResolvedValueOnce({ rows: [{ ...item, row_version: 0 }] }) };
  await expect(findGate({ client, request, approvalLevel: 2 })).resolves.toMatchObject({ state: STATE, requiredCaseIds: [101] });
  expect(client.query.mock.calls[1][0]).toContain("'NEEDS_ASSESSMENT'");
  expect(client.query.mock.calls[1][0]).not.toMatch(/score|tier|impact|risk|deadline|dependency|regulatory|strategic|rank/i);
});

test('existing profile does not invoke neutral provisioning', async () => {
  const item = { procurement_case_id: 101, row_version: 1, department_rank: null };
  const client = { query: jest.fn().mockResolvedValueOnce({ rows: [item] }).mockResolvedValueOnce({ rows: [item] }) };
  await expect(findGate({ client, request, approvalLevel: 2 })).resolves.toMatchObject({ state: STATE });
  expect(client.query).toHaveBeenCalledTimes(2);
  expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO procurement_priority_profiles'))).toBe(false);
});

test('multi-item request keeps every applicable procurement case distinct', async () => {
  const rows = [
    { procurement_case_id: 101, row_version: 1, department_rank: null },
    { procurement_case_id: 102, row_version: 1, department_rank: null },
    { procurement_case_id: 103, row_version: 1, department_rank: 1 },
  ];
  const client = { query: jest.fn().mockResolvedValueOnce({ rows }).mockResolvedValueOnce({ rows }) };
  const gate = await findGate({ client, request, approvalLevel: 4 });
  expect(gate.requiredCaseIds).toEqual([101, 102]);
  expect(gate.queue).toHaveLength(3);
});

test('already ranked cases make a retry gate-free and gate creation is audited', async () => {
  const client = { query: jest.fn().mockResolvedValueOnce({ rows: [{ procurement_case_id: 101, row_version: 1, department_rank: 1 }] }) };
  await expect(findGate({ client, request, approvalLevel: 2 })).resolves.toBeNull();
  const gate = { state: STATE, requiredCaseIds: [101] };
  await auditGate({ client, request, approval: { id: 8, approval_level: 2 }, actorId: 6, gate });
  expect(writeAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: STATE, client, instituteId: 7, requestId: 41 }));
});