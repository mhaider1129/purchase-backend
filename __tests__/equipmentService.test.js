jest.mock('../services/auditService', () => ({ writeAuditEvent: jest.fn() }));
const { EquipmentService } = require('../services/equipmentService');

const ctx = { instituteId: 7, userId: 11 };
const transactional = overrides => {
  const tx = { db: {}, get: jest.fn(), asset: jest.fn(), department: jest.fn(), save: jest.fn() };
  Object.assign(tx, overrides);
  return { tx, repo: { transaction: jest.fn(work => work(tx)), list: jest.fn(), get: jest.fn() } };
};

test('linked equipment derives duplicate identity fields from its authoritative asset', async () => {
  const asset = { id: 8, description: 'TrueBeam LINAC', manufacturer: 'Varian', model: 'TrueBeam', serial_number: 'TB-1', responsible_department_id: 4 };
  const { repo, tx } = transactional({ asset: jest.fn().mockResolvedValue(asset), save: jest.fn().mockImplementation((_id, _institute, data) => Promise.resolve({ id: 2, ...data })) });
  const audit = jest.fn();
  const row = await new EquipmentService(repo, audit).save(null, { asset_id: 8, equipment_code: 'EQ-1', name: 'wrong', manufacturer: 'wrong', model: 'wrong' }, ctx);
  expect(row).toMatchObject({ asset_id: 8, name: 'TrueBeam LINAC', manufacturer: 'Varian', model: 'TrueBeam', serial_number: 'TB-1', department_id: 4 });
  expect(tx.save).toHaveBeenCalledWith(null, 7, expect.objectContaining({ name: asset.description }));
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ client: tx.db, action: 'MAINTAINABLE_EQUIPMENT_CREATED' }));
});

test('asset links fail closed when the asset is outside the institute', async () => {
  const { repo, tx } = transactional({ asset: jest.fn().mockResolvedValue(null) });
  await expect(new EquipmentService(repo, jest.fn()).save(null, { asset_id: 99, equipment_code: 'EQ-1' }, ctx)).rejects.toMatchObject({ statusCode: 400, code: 'EQUIPMENT_ASSET_INVALID' });
  expect(tx.asset).toHaveBeenCalledWith(99, 7);
  expect(tx.save).not.toHaveBeenCalled();
});

test('new equipment requires an authoritative Asset link', async () => {
  const { repo, tx } = transactional();
  await expect(new EquipmentService(repo, jest.fn()).save(null, { equipment_code: 'EQ-1', name: 'Pump', manufacturer: 'Acme', model: 'P1' }, ctx)).rejects.toMatchObject({ statusCode: 400, code: 'EQUIPMENT_ASSET_REQUIRED' });
  expect(tx.save).not.toHaveBeenCalled();
});

test('legacy unlinked equipment can be edited while awaiting reconciliation', async () => {
  const before = { id: 2, asset_id: null, equipment_code: 'EQ-1', name: 'Pump', manufacturer: 'Acme', model: 'P1', department_id: 4 };
  const { repo, tx } = transactional({ get: jest.fn().mockResolvedValue(before), department: jest.fn().mockResolvedValue({ id: 4 }), save: jest.fn().mockResolvedValue(before) });
  await new EquipmentService(repo, jest.fn()).save(2, { name: 'Pump 2' }, ctx);
  expect(tx.department).toHaveBeenCalledWith(4, 7);
});

test('linked equipment cannot be detached from its Asset', async () => {
  const { repo, tx } = transactional({ get: jest.fn().mockResolvedValue({ id: 2, asset_id: 8 }) });
  await expect(new EquipmentService(repo, jest.fn()).save(2, { asset_id: '' }, ctx)).rejects.toMatchObject({ statusCode: 409, code: 'EQUIPMENT_ASSET_DETACH_FORBIDDEN' });
  expect(tx.save).not.toHaveBeenCalled();
});

test('duplicate asset links return a domain conflict', async () => {
  const duplicate = Object.assign(new Error('duplicate'), { code: '23505', constraint: 'maintainable_equipment_asset_uq' });
  const { repo } = transactional({ asset: jest.fn().mockResolvedValue({ id: 8, description: 'Pump' }), save: jest.fn().mockRejectedValue(duplicate) });
  await expect(new EquipmentService(repo, jest.fn()).save(null, { asset_id: 8, equipment_code: 'EQ-1' }, ctx)).rejects.toMatchObject({ statusCode: 409, code: 'EQUIPMENT_ASSET_ALREADY_LINKED' });
});

test('unrelated uniqueness violations are not mislabeled as Asset-link conflicts', async () => {
  const duplicateCode = Object.assign(new Error('duplicate'), { code: '23505', constraint: 'maintainable_equipment_institute_code_uq' });
  const { repo } = transactional({ asset: jest.fn().mockResolvedValue({ id: 8, description: 'Pump' }), save: jest.fn().mockRejectedValue(duplicateCode) });
  await expect(new EquipmentService(repo, jest.fn()).save(null, { asset_id: 8, equipment_code: 'EQ-1' }, ctx)).rejects.toBe(duplicateCode);
});

test('available Asset lookup is scoped to the actor institute', async () => {
  const repo = { availableAssets: jest.fn().mockResolvedValue([]) };
  await new EquipmentService(repo).availableAssets({ search: 'LINAC' }, ctx);
  expect(repo.availableAssets).toHaveBeenCalledWith(7, { search: 'LINAC' });
});

test('equipment reads remain institute scoped', async () => {
  const repo = { get: jest.fn().mockResolvedValue(null) };
  await expect(new EquipmentService(repo).get(3, ctx)).rejects.toMatchObject({ statusCode: 404 });
  expect(repo.get).toHaveBeenCalledWith(3, 7);
});