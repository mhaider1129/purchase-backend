'use strict';

const { createProcurementPriorityRepository } = require('../../repositories/procurementPriorityRepository');

test.each([
  ['departmentQueue', repository => repository.departmentQueue(7, 9)],
  ['managementQueue', repository => repository.managementQueue(7)],
])('%s uses columns present in the requests schema for request references', async (_name, invoke) => {
  const database = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  const repository = createProcurementPriorityRepository(database);

  await invoke(repository);

  const sql = database.query.mock.calls[0][0];
  expect(sql).toContain("NULLIF(r.maintenance_ref_number,'')");
  expect(sql).not.toContain('r.request_number');
});

test('reorderDepartment writes an integer-compatible audit target', async () => {
  const client = {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 13, row_version: 1 }, { id: 14, row_version: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [] }),
  };
  const repository = createProcurementPriorityRepository({});

  await repository.reorderDepartment({
    instituteId: 7,
    departmentId: 9,
    orderedCaseIds: [14, 13],
    version: 1,
    actorId: 5,
    client,
  });

  const auditCall = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO audit_logs'));
  expect(auditCall).toBeDefined();
  expect(auditCall[1][3]).toBe('9');
  expect(auditCall[1][3]).not.toContain(':');
});