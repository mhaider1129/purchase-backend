const engine = require('../services/approvalPolicyEngine');
const step = { approvalLevel: 1, stepOrder: 1, resolverType: 'REQUESTER', semanticKey: 'REQUESTER' };
const variants = [
  ['NONSTOCK_MED_HIGH', 'Medical', 'AMOUNT_GTE'],
  ['NONSTOCK_MED_STANDARD', 'Medical', 'AMOUNT_LT'],
  ['NONSTOCK_OP_HIGH', 'Operational', 'AMOUNT_GTE'],
  ['NONSTOCK_OP_STANDARD', 'Operational', 'AMOUNT_LT'],
];
// Explicit fixture for the requested design, not an export of the deployed policy.
const version = { id: 12, version_number: 1, status: 'SHADOW', policy: { id: 8, name: 'Non-Stock', instituteId: 1 }, rules: variants.map(([code, classification, amountType], index) => ({
  code, priority: index + 1, isActive: true, conditions: [
    { type: 'REQUEST_TYPE_EQUALS', value: 'Non-Stock' },
    { type: 'DEPARTMENT_CLASSIFICATION_EQUALS', value: classification },
    { type: 'IS_NON_STOCK_REQUEST', value: 'true' },
    { type: amountType, value: '5000001' },
  ], steps: [step],
})) };
const facts = (classification, amount, extra = {}) => ({ instituteId: 1, requesterId: 39, requestType: 'Non-Stock', departmentClassification: classification, estimatedAmount: amount, isStockRequest: false, ...extra });
test.each([
  ['Medical', '25200000', 'NONSTOCK_MED_HIGH'],
  ['Medical', '5000000', 'NONSTOCK_MED_STANDARD'],
  ['Medical', '5000001', 'NONSTOCK_MED_HIGH'],
  ['Operational', '0', 'NONSTOCK_OP_STANDARD'],
  ['Operational', '5000000', 'NONSTOCK_OP_STANDARD'],
  ['Operational', '5000001', 'NONSTOCK_OP_HIGH'],
])('%s Non-Stock %s matches only %s', async (classification, amount, code) => {
  const route = await engine.composeShadowRoute(version, facts(classification, amount), { organization: {} });
  expect(route.matchedRules.map(rule => rule.code)).toEqual([code]);
  expect(route.ruleDiagnostics).toHaveLength(4);
  const matched = route.ruleDiagnostics.find(rule => rule.code === code);
  expect(matched.result).toBe('MATCH');
  expect(matched.conditions.every(condition => condition.result === 'PASS')).toBe(true);
  expect(route.policy).toMatchObject({ versionId: 12, versionNumber: 1, activeRuleCount: 4 });
});
test.each(['Stock', 'Maintenance', 'Medical Device'])('%s cannot enter Non-Stock merely by a boolean flag', async requestType => {
  const route = await engine.composeShadowRoute(version, facts('Medical', '25200000', { requestType, isStockRequest: requestType === 'Stock' }), { organization: {} });
  expect(route.matchedRules).toEqual([]);
  expect(route.ruleDiagnostics.every(rule => rule.conditions[0].result === 'FAIL')).toBe(true);
});
test('unknown facts stay UNKNOWN, and a definite failure is still explained separately', async () => {
  const route = await engine.composeShadowRoute(version, facts(null, null, { isStockRequest: null }), { organization: {} });
  expect(route.matchedRules).toEqual([]);
  expect(route.ruleDiagnostics.every(rule => rule.result === 'UNKNOWN')).toBe(true);
  expect(route.ruleDiagnostics[0].conditions.map(condition => condition.result)).toEqual(['PASS', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
  const noMatch = await engine.composeShadowRoute(version, facts(null, null, { requestType: 'Stock', isStockRequest: null }), { organization: {} });
  expect(noMatch.ruleDiagnostics[0].result).toBe('NO MATCH');
  expect(noMatch.ruleDiagnostics[0].conditions[1].result).toBe('UNKNOWN');
});
test('diagnostics expose exact request-type spelling while recognizing controlled classification case variants', async () => {
  const route = await engine.composeShadowRoute(version, facts('medical', '25200000', { requestType: 'NON-STOCK' }), { organization: {} });
  expect(route.matchedRules).toEqual([]);
  expect(route.ruleDiagnostics[0].conditions[0]).toMatchObject({ expected: 'Non-Stock', actual: 'NON-STOCK', configuredValue: 'Non-Stock', result: 'FAIL' });
  expect(route.ruleDiagnostics[0].conditions[1]).toMatchObject({ expected: 'Medical', actual: 'medical', result: 'PASS' });
});
test.each(['Medical','medical','MEDICAL'])('editor lowercase policy conditions match classification %s without changing thresholds',async classification=>{
  const configuration={...version,rules:version.rules.map(rule=>({...rule,conditions:rule.conditions.map(condition=>condition.type==='DEPARTMENT_CLASSIFICATION_EQUALS'?{...condition,value:condition.value.toLowerCase()}:condition)}))};
  const route=await engine.composeShadowRoute(configuration,facts(classification,'25200000'),{organization:{}});
  expect(route.matchedRules.map(rule=>rule.code)).toEqual(['NONSTOCK_MED_HIGH']);
});
test('unrecognized classifications retain exact equality and cannot match Medical or Operational rules',async()=>{
  const route=await engine.composeShadowRoute(version,facts('Medical Support','25200000'),{organization:{}});
  expect(route.matchedRules).toEqual([]);
  expect(engine.evaluateCondition({type:'DEPARTMENT_CLASSIFICATION_EQUALS',value:'Other'},{departmentClassification:'other'})).toBe(false);
});
test('stop-processing preserves routing while diagnosing every active rule', async () => {
  const resolveCapability = jest.fn();
  const configuration = { ...version, rules: [
    { code: 'FIRST', priority: 1, stopProcessing: true, conditions: [], steps: [step] },
    { code: 'AFTER_STOP', priority: 2, conditions: [], steps: [{ ...step, resolverType: 'CEO_AUTHORITY' }] },
    { code: 'INACTIVE', priority: 3, isActive: false, conditions: [], steps: [] },
  ] };
  const route = await engine.composeShadowRoute(configuration, facts('Medical', '0'), { organization: {}, resolveCapability });
  expect(route.matchedRules.map(rule => rule.code)).toEqual(['FIRST']);
  expect(route.ruleDiagnostics).toHaveLength(2);
  expect(route.ruleDiagnostics[1]).toMatchObject({ result: 'MATCH', selected: false, skippedBy: 'FIRST' });
  expect(resolveCapability).not.toHaveBeenCalled();
});
test('existing Medical Stock matching remains unchanged', async () => {
  const stock = { ...version, rules: [{ code: 'MED_STOCK', priority: 1, conditions: [{ type: 'REQUEST_TYPE_EQUALS', value: 'Stock' }, { type: 'DEPARTMENT_CLASSIFICATION_EQUALS', value: 'Medical' }, { type: 'IS_STOCK_REQUEST', value: 'true' }], steps: [step] }, ...version.rules] };
  const route = await engine.composeShadowRoute(stock, facts('Medical', '25200000', { requestType: 'Stock', isStockRequest: true }), { organization: {} });
  expect(route.matchedRules.map(rule => rule.code)).toEqual(['MED_STOCK']);
});
test('legacy normalization preserves only explicit metadata and never derives purposes from rank or role', () => {
  const rows = [{ approval_level: 1, approver_id: 3, role: 'CFO', department: 'Medical', position: 'Head' }, { approval_level: 2, approver_id: 4, semantic_key: 'AUTHORITATIVE_PURPOSE' }];
  const before = JSON.stringify(rows);
  const current = engine.normalizeCurrentRoute(rows);
  expect(current.map(row => row.semanticKey)).toEqual(['LEGACY_SEMANTIC_UNKNOWN', 'AUTHORITATIVE_PURPOSE']);
  expect(JSON.stringify(rows)).toBe(before);
  expect(engine.LIVE_ROUTING_ENABLED).toBe(false);
});
