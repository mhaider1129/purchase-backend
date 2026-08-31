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