const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockAudit = jest.fn();
const mockRepository = {};
jest.mock('../repositories/organizationRepository', () => mockRepository);
jest.mock('../config/db', () => ({ query: (...args) => mockQuery(...args), connect: (...args) => mockConnect(...args) }));
jest.mock('../services/auditService', () => ({ writeAuditEvent: (...args) => mockAudit(...args) }));
const { createOrganizationService } = require('../services/organizationService');
const engine = require('../services/approvalPolicyEngine');
const delegations = require('../services/approvalDelegationService');
const snapshots = require('../services/approvalRouteSnapshotService');
const actor = { id: 901, instituteId: 17 };
const at = '2026-10-12T12:00:00Z';
const body = { organizationPositionId: 501, delegateUserId: 702, scope: 'PURCHASE_REQUEST_APPROVAL', reason: 'Purchase approval authority', effectiveFrom: '2026-10-10T00:00:00Z', effectiveTo: '2026-10-20T00:00:00Z' };
const structuralPosition = { id: 501, organization_unit_id: 91, position_type: 'EXECUTIVE_HEAD', position_name: 'Chief Executive Officer', user_id: null, is_unit_head: true, is_active: true, effective_from: '2026-01-01', effective_to: null };
const version = { policy: { id: 1 }, rules: [{ code: 'EXECUTIVE', priority: 1, conditions: [], steps: [{ approvalLevel: 2, stepOrder: 1, resolverType: 'EXECUTIVE_OWNER', semanticKey: 'EXECUTIVE_AUTHORIZATION' }] }] };
const facts = { instituteId: 17, departmentId: 44, evaluationTime: at };
const active = { id: 801, institute_id: 17, organization_position_id: 501, delegate_user_id: 702, status: 'ACTIVE', scope: body.scope, effective_from: body.effectiveFrom, effective_to: body.effectiveTo, delegate_active: true };

function organizationFixture(position = structuralPosition, duplicate = false) {
  const units = [
    { id: 1, name: 'Institute', institute_id: 17, unit_type: 'INSTITUTE', is_active: true },
    { id: 91, name: 'CEO Executive Office', institute_id: 17, unit_type: 'EXECUTIVE_OFFICE', parent_unit_id: 1, is_active: true },
    { id: 40, name: 'Nursing Directorate', institute_id: 17, unit_type: 'DIRECTORATE', parent_unit_id: 91, is_active: true },
    { id: 41, name: 'Nursing', institute_id: 17, department_id: 44, unit_type: 'DEPARTMENT', parent_unit_id: 40, is_active: true },
    { id: 92, name: 'COO', institute_id: 17, unit_type: 'EXECUTIVE_OFFICE', parent_unit_id: 1, is_active: true },
    { id: 93, name: 'CMO', institute_id: 17, unit_type: 'EXECUTIVE_OFFICE', parent_unit_id: 1, is_active: true },
  ];
  const repo = {
    get: async id => units.find(u => String(u.id) === String(id)),
    list: async () => units,
    ancestors: async id => id === 41 ? units.slice(0, 3) : [],
    positions: async id => String(id) === '91' ? [position, ...(duplicate ? [{ ...position, id: 502 }] : [])] : [],
  };
  return createOrganizationService(repo, mockAudit);
}
function effectiveClient(rows) {
  return { query: jest.fn(async (sql, params) => {
    expect(sql).toContain("d.status='ACTIVE'");
    expect(sql).toContain('d.effective_from<=$5');
    expect(sql).toContain('d.effective_to>$5');
    expect(sql).toContain('u.institute_id=d.institute_id');
    const [institute, scope, position, holder, time] = params;
    return { rows: rows.filter(d => d.institute_id === institute && d.scope === scope && d.status === 'ACTIVE' && d.delegate_active && d.effective_from <= time && d.effective_to > time && (position ? d.organization_position_id === position : !d.organization_position_id && d.delegator_user_id === holder)).map(d => ({ id: d.id, delegateUserId: d.delegate_user_id, delegateUserName: 'COO user' })) };
  }) };
}
async function route(position, rows = [], duplicate = false) {
  const organization = organizationFixture(position, duplicate);
  const resolver = jest.fn(input => delegations.resolve(input, effectiveClient(rows)));
  const result = await engine.composeShadowRoute(version, facts, { organization: { resolveExecutiveOwner: organization.resolveStructuralExecutiveOwner }, resolveDelegation: resolver });
  return { step: result.steps[0], resolver, organization };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockConnect.mockResolvedValue({ query: mockQuery, release: jest.fn() });
  mockQuery.mockResolvedValue({ rows: [] });
  mockAudit.mockResolvedValue();
});
test.each([
  ['staffed without delegation', { ...structuralPosition, user_id: 701, user_is_active: true }, [], 'RESOLVED', 701],
  ['staffed delegated', { ...structuralPosition, user_id: 701, user_is_active: true }, [active], 'DELEGATED', 702],
  ['unstaffed without delegation', structuralPosition, [], 'UNRESOLVED', null],
  ['unstaffed delegated', structuralPosition, [active], 'DELEGATED', 702],
  ['expired delegation', structuralPosition, [{ ...active, effective_to: at }], 'UNRESOLVED', null],
  ['future delegation', structuralPosition, [{ ...active, effective_from: '2026-10-13T00:00:00Z' }], 'UNRESOLVED', null],
  ['revoked delegation', structuralPosition, [{ ...active, status: 'REVOKED' }], 'UNRESOLVED', null],
  ['inactive delegate', structuralPosition, [{ ...active, delegate_active: false }], 'UNRESOLVED', null],
  ['foreign institute delegation', structuralPosition, [{ ...active, institute_id: 18 }], 'UNRESOLVED', null],
])('%s', async (_label, position, rows, resolutionStatus, userId) => {
  const { step } = await route(position, rows);
  expect(step).toMatchObject({ resolutionStatus, userId, positionId: 501, unitId: 91, positionHolderId: position.user_id, requiredAuthority: 'Chief Executive Officer' });
});
test('Nursing ancestry preserves unstaffed CEO identity, legacy resolver remains holder-only', async () => {
  const { step, resolver, organization } = await route(structuralPosition, [active]);
  expect(step).toMatchObject({ structuralHolderId: null, actingApproverId: 702, delegationId: 801, resolvedPositionId: 501, resolvedUnitId: 91, resolutionType: 'DELEGATED' });
  expect(resolver).toHaveBeenCalledWith({ instituteId: 17, delegatorUserId: null, positionId: 501, scope: body.scope, at });
  expect(await organization.resolveExecutiveOwner(44, 17)).toBeNull();
  expect(await organization.resolveStructuralExecutiveOwner(44, 18, at)).toMatchObject({ status: 'UNASSIGNED' });
});
test('ambiguous CEO positions cannot use an otherwise valid delegation', async () => {
  const { step, resolver } = await route(structuralPosition, [active], true);
  expect(step.resolutionStatus).toBe('AMBIGUOUS');
  expect(resolver).not.toHaveBeenCalled();
});
test('multiple effective delegations fail closed', async () => {
  expect((await route(structuralPosition, [active, { ...active, id: 802 }])).step).toMatchObject({ resolutionStatus: 'AMBIGUOUS', userId: null, actingApproverId: null });
});
test('direct user delegation still resolves without position identity', async () => {
  const result = await engine.composeShadowRoute({ ...version, rules: [{ ...version.rules[0], steps: [{ ...version.rules[0].steps[0], resolverType: 'FIXED_USER', resolverReference: '701' }] }] }, facts, {
    resolveFixedUser: async () => ({ userId: 701 }), resolveDelegation: input => delegations.resolve(input, effectiveClient([{ ...active, organization_position_id: null, delegator_user_id: 701 }])),
  });
  expect(result.steps[0]).toMatchObject({ userId: 702, structuralHolderId: 701, resolutionStatus: 'DELEGATED' });
});
test('snapshot consumes the resolved V2 step with null holder and complete structural provenance', async () => {
  const { step } = await route(structuralPosition, [active]);
  mockQuery.mockImplementation(async sql => ({ rows: sql.startsWith('INSERT INTO approval_route_snapshots') ? [{ id: 888 }] : [] }));
  await snapshots.createGenerationTransaction({ requestId: 3, policyId: 1, policyVersionId: 2, generationNumber: 1, factsSnapshot: facts, steps: [step] }, actor);
  const params = mockQuery.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO approval_route_snapshot_steps'))[1];
  expect(params.slice(7, 14)).toEqual(['Chief Executive Officer', 91, 501, null, 702, 801, 'DELEGATED']);
});
function creationFixture(position = {}, delegateExists = true, conflict = false) {
  mockQuery.mockImplementation(async sql => {
    if (sql.startsWith('SELECT id FROM users')) return { rows: delegateExists ? [{ id: 702 }] : [] };
    if (sql.includes('FROM organization_positions op JOIN')) return { rows: [{ ...structuralPosition, unit_active: true, ...position }] };
    if (sql.startsWith('INSERT INTO approval_authority')) {
      if (conflict) throw Object.assign(new Error('overlap'), { code: '23P01' });
      return { rows: [{ id: 801, organization_position_id: 501, delegator_user_id: position.user_id ?? null }] };
    }
    return { rows: [] };
  });
}
test('create unstaffed position delegation ignores frontend institute and audits null delegator transactionally', async () => {
  creationFixture();
  await expect(delegations.create({ ...body, instituteId: 999 }, actor)).resolves.toMatchObject({ delegator_user_id: null });
  expect(mockQuery.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO approval_authority'))[1].slice(0, 4)).toEqual([17, 501, null, 702]);
  expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ client: expect.anything(), action: 'APPROVAL_AUTHORITY_DELEGATED', afterData: expect.objectContaining({ delegator_user_id: null }) }));
  expect(mockQuery).toHaveBeenCalledWith('COMMIT');
});
test('staffed position keeps holder context and self-delegation remains rejected', async () => {
  creationFixture({ user_id: 701, holder_id: 701, holder_active: true, holder_institute_id: 17 });
  await delegations.create(body, actor);
  expect(mockQuery.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO approval_authority'))[1][2]).toBe(701);
  await expect(delegations.create({ ...body, delegateUserId: 701 }, actor)).rejects.toMatchObject({ code: 'SELF_DELEGATION' });
});
test('unstaffed authority cannot claim a fake delegator', async () => {
  creationFixture();
  await expect(delegations.create({ ...body, delegatorUserId: 701 }, actor)).rejects.toMatchObject({ code: 'POSITION_HOLDER_MISMATCH' });
});
test.each(['cross-institute', 'inactive'])('%s delegate rejected before insertion', async () => {
  creationFixture({}, false);
  await expect(delegations.create(body, actor)).rejects.toMatchObject({ code: 'INVALID_DELEGATE' });
  expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('institute_id=$2 AND COALESCE(is_active,true)'), [702, 17]);
  expect(mockQuery.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
});
test.each([
  [{ unit_active: false }, 'INACTIVE_AUTHORITY_UNIT'],
  [{ is_active: false }, 'AUTHORITY_PERIOD_NOT_COVERED'],
  [{ effective_from: '2026-10-11' }, 'AUTHORITY_PERIOD_NOT_COVERED'],
  [{ effective_to: '2026-10-18' }, 'AUTHORITY_PERIOD_NOT_COVERED'],
  [{ user_id: 701, holder_id: 701, holder_institute_id: 18, holder_active: true }, 'INVALID_STRUCTURAL_HOLDER'],
])('invalid position context %j fails closed', async (position, code) => {
  creationFixture(position);
  await expect(delegations.create(body, actor)).rejects.toMatchObject({ code });
  expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');
});
test('overlap rejection applies to unstaffed authority', async () => {
  creationFixture({}, true, true);
  await expect(delegations.create(body, actor)).rejects.toMatchObject({ code: 'DELEGATION_PERIOD_CONFLICT' });
});
test('unstaffed authority cannot delegate to a user who already delegates onward', async () => {
  creationFixture(); const normal = mockQuery.getMockImplementation();
  mockQuery.mockImplementation(async (sql, params) => sql.includes('FROM approval_authority_delegations d') ? { rows: [{ id: 900 }] } : normal(sql, params));
  await expect(delegations.create(body, actor)).rejects.toMatchObject({ code: 'DELEGATION_CHAIN_NOT_SUPPORTED' });
  expect(mockQuery.mock.calls.find(([sql]) => sql.includes('FROM approval_authority_delegations d'))[1]).toEqual([17, body.effectiveFrom, body.effectiveTo, null, 702]);
});
test('missing institute fails closed for creation, resolution and options', async () => {
  await expect(delegations.create(body, { id: 1 })).rejects.toMatchObject({ statusCode: 403 });
  await expect(delegations.resolve({ positionId: 501 })).rejects.toMatchObject({ statusCode: 403 });
  await expect(delegations.options({ id: 1 })).rejects.toMatchObject({ statusCode: 403 });
  expect(mockQuery).not.toHaveBeenCalled();
});
test('delegation options include unstaffed positions without granting user-management access', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [structuralPosition] }).mockResolvedValueOnce({ rows: [{ id: 702, name: 'Delegate' }] });
  expect(await delegations.options(actor)).toMatchObject({ positions: [{ user_id: null }], users: [{ id: 702 }] });
  expect(mockQuery.mock.calls[0][0]).toContain('LEFT JOIN users');
  expect(mockQuery.mock.calls[0][0]).not.toContain('op.user_id IS NOT NULL');
  expect(mockQuery.mock.calls.map(([, params]) => params)).toEqual([[17], [17]]);
});
test('no live V2 cutover or identity-specific routing is introduced', () => {
  expect(engine.LIVE_ROUTING_ENABLED).toBe(false);
  const fs = require('fs');
  for (const name of ['approvalPolicyEngine', 'organizationAuthorityService', 'approvalDelegationService', 'approvalPolicyShadowService']) {
    expect(fs.readFileSync(require.resolve(`../services/${name}`), 'utf8')).not.toMatch(/Omar Zeyad|WICI|unitId\s*===?\s*91/);
  }
});

test('real shadow/simulation dependency adapters preserve unstaffed position identity',async()=>{
  Object.assign(mockRepository, organizationFixture().repo);
  const deps=require('../services/approvalPolicyShadowService').dependencies;
  expect(await deps.organization.resolveExecutiveOwner(44,17,at)).toMatchObject({status:'POSITION_UNSTAFFED',positionId:501,userId:null,organizationUnitId:91});
  expect(await deps.organization.resolvePosition('91:EXECUTIVE_HEAD',17,at)).toMatchObject({status:'POSITION_UNSTAFFED',positionId:501,userId:null});
  expect(await deps.organization.resolvePosition('91:EXECUTIVE_HEAD',18,at)).toMatchObject({status:'UNASSIGNED'});
});
test('position date bounds returned as Date objects still cover the period',()=>{
  expect(delegations.covers({effective_from:new Date('2026-10-10T00:00:00Z'),effective_to:new Date('2026-10-20T00:00:00Z')},new Date(body.effectiveFrom),new Date(body.effectiveTo))).toBe(true);
  expect(delegations.covers({effective_to:new Date('2026-10-19T00:00:00Z')},new Date(body.effectiveFrom),new Date(body.effectiveTo))).toBe(false);
});
