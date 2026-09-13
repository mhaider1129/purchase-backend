jest.mock('../services/auditService', () => ({ writeAuditEvent: jest.fn() }));
const { ContractEquipmentCoverageService } = require('../services/contractEquipmentCoverageService');

const ctx = { instituteId: 7, userId: 11 };
const transactional = overrides => {
  const tx = { db: {}, equipment: jest.fn(), contract: jest.fn(), overlapping: jest.fn().mockResolvedValue(null), create: jest.fn(), remove: jest.fn() };
  Object.assign(tx, overrides);
  return { tx, repo: { transaction: jest.fn(work => work(tx)), equipment: jest.fn(), list: jest.fn() } };
};
const coverage = { contract_id: 3, coverage_type: 'COMPREHENSIVE', coverage_start: '2026-01-01', coverage_end: '2026-12-31', pm_included: true, parts_included: true };

test('creates effective-dated coverage for same-institute Equipment and Contract', async () => {
  const contract = { id: 3, start_date: '2026-01-01', end_date: '2026-12-31' };
  const { repo, tx } = transactional({ equipment: jest.fn().mockResolvedValue({ id: 5 }), contract: jest.fn().mockResolvedValue(contract), create: jest.fn().mockResolvedValue({ id: 9 }) });
  const audit = jest.fn();
  await new ContractEquipmentCoverageService(repo, audit).create(5, coverage, ctx);
  expect(tx.contract).toHaveBeenCalledWith(3, 7);
  expect(tx.create).toHaveBeenCalledWith(expect.objectContaining({ equipment_id: 5, parts_included: true }), 7, 11);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ client: tx.db, action: 'CONTRACT_EQUIPMENT_COVERAGE_CREATED' }));
});

test('rejects foreign or unresolved Contract ownership', async () => {
  const { repo, tx } = transactional({ equipment: jest.fn().mockResolvedValue({ id: 5 }), contract: jest.fn().mockResolvedValue(null) });
  await expect(new ContractEquipmentCoverageService(repo, jest.fn()).create(5, coverage, ctx)).rejects.toMatchObject({ statusCode: 400, code: 'EQUIPMENT_CONTRACT_INVALID' });
  expect(tx.create).not.toHaveBeenCalled();
});

test('coverage dates must remain within Contract dates', async () => {
  const { repo, tx } = transactional({ equipment: jest.fn().mockResolvedValue({ id: 5 }), contract: jest.fn().mockResolvedValue({ id: 3, start_date: '2026-02-01', end_date: '2026-11-30' }) });
  await expect(new ContractEquipmentCoverageService(repo, jest.fn()).create(5, coverage, ctx)).rejects.toMatchObject({ statusCode: 400 });
  expect(tx.create).not.toHaveBeenCalled();
});

test('rejects overlapping coverage of the same type', async () => {
  const { repo, tx } = transactional({ equipment: jest.fn().mockResolvedValue({ id: 5 }), contract: jest.fn().mockResolvedValue({ id: 3, start_date: '2026-01-01', end_date: '2026-12-31' }), overlapping: jest.fn().mockResolvedValue({ id: 8 }) });
  await expect(new ContractEquipmentCoverageService(repo).create(5, coverage, ctx)).rejects.toMatchObject({ statusCode: 409, code: 'EQUIPMENT_CONTRACT_COVERAGE_OVERLAP' });
  expect(tx.create).not.toHaveBeenCalled();
});

test('rejects invalid SLA values and non-boolean coverage flags before persistence', async () => {
  const { repo } = transactional();
  await expect(new ContractEquipmentCoverageService(repo).create(5, { ...coverage, uptime_target_percent: 101 }, ctx)).rejects.toMatchObject({ statusCode: 400 });
  await expect(new ContractEquipmentCoverageService(repo).create(5, { ...coverage, labor_included: 'yes' }, ctx)).rejects.toMatchObject({ statusCode: 400 });
  expect(repo.transaction).not.toHaveBeenCalled();
});

test('removal is scoped by Equipment and institute and audited transactionally', async () => {
  const removed = { id: 9, equipment_id: 5, contract_id: 3 };
  const { repo, tx } = transactional({ equipment: jest.fn().mockResolvedValue({ id: 5 }), remove: jest.fn().mockResolvedValue(removed) });
  const audit = jest.fn();
  await new ContractEquipmentCoverageService(repo, audit).remove(5, 9, ctx);
  expect(tx.remove).toHaveBeenCalledWith(9, 5, 7);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'CONTRACT_EQUIPMENT_COVERAGE_REMOVED', beforeData: removed }));
});