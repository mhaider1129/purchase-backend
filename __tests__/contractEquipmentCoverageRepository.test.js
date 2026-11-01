const ContractEquipmentCoverageRepository = require('../repositories/contractEquipmentCoverageRepository');

test('Contract resolution fails closed unless all known ownership signals match the institute', async () => {
  const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  await new ContractEquipmentCoverageRepository(db).contract(3, 7);
  const [sql, params] = db.query.mock.calls[0];
  expect(sql).toContain(require('../services/contractAuthorizationService').ownership('c'));
  expect(sql).toContain(require('../services/contractAuthorizationService').ownerSql('c')+'=$2');
  expect(sql).not.toContain('creator.institute_id');
  expect(params).toEqual([3, 7]);
});

test('coverage deletion is scoped by coverage, Equipment, and institute', async () => {
  const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  await new ContractEquipmentCoverageRepository(db).remove(9, 5, 7);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('id=$1 AND equipment_id=$2 AND institute_id=$3'), [9, 5, 7]);
});

test('overlap detection uses inclusive effective-date ranges', async () => {
  const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  await new ContractEquipmentCoverageRepository(db).overlapping(5, 'COMPREHENSIVE', '2026-01-01', '2026-12-31', 7);
  expect(db.query.mock.calls[0][0]).toContain("daterange(coverage_start,coverage_end,'[]') && daterange($4::date,$5::date,'[]')");
});