const ContractEquipmentCoverageRepository = require('../repositories/contractEquipmentCoverageRepository');

test('Contract resolution fails closed unless all known ownership signals match the institute', async () => {
  const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  await new ContractEquipmentCoverageRepository(db).contract(3, 7);
  const [sql, params] = db.query.mock.calls[0];
  expect(sql).toContain('COALESCE(creator.institute_id,owner_department.institute_id,manager.institute_id)=$2');
  expect(sql).toContain('(creator.institute_id IS NULL OR creator.institute_id=$2)');
  expect(sql).toContain('(owner_department.institute_id IS NULL OR owner_department.institute_id=$2)');
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