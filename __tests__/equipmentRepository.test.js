const EquipmentRepository = require('../repositories/equipmentRepository');

test('available Assets exclude disposed and already-linked records in the institute', async () => {
  const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  await new EquipmentRepository(db).availableAssets(7, { search: 'LINAC', limit: 20, includeAssetId: 8 });
  const [sql, params] = db.query.mock.calls[0];
  expect(sql).toContain("a.institute_id=$1");
  expect(sql).toContain("a.operational_status<>'DISPOSED'");
  expect(sql).toContain('(e.id IS NULL OR a.id=$2)');
  expect(params).toEqual([7, 8, 'LINAC', 20]);
});

test('equipment reads prefer current Asset identity over legacy snapshots', async () => {
  const db = { query: jest.fn().mockResolvedValue({ rows: [{ id: 2 }] }) };
  await new EquipmentRepository(db).get(2, 7);
  const [sql] = db.query.mock.calls[0];
  for (const canonical of ['a.description END name', 'a.manufacturer END manufacturer', 'a.model END model', 'a.serial_number END serial_number', 'a.responsible_department_id END department_id']) expect(sql).toContain(canonical);
});

test('equipment list searches and sorts using current Asset identity', async () => {
  const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  await new EquipmentRepository(db).list(7, { search: 'Varian' });
  const [sql] = db.query.mock.calls[0];
  expect(sql).toContain('ELSE a.description END ILIKE');
  expect(sql).toContain('ELSE a.manufacturer END ILIKE');
  expect(sql).toContain('ORDER BY CASE WHEN e.asset_id IS NULL THEN e.name ELSE a.description END');
});