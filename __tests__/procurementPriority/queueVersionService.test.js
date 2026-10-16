const { assertQueueVersions } = require('../../services/procurementPriority/queueVersionService');
const rows = [{ id:11,row_version:3 },{ id:12,row_version:8 }];
test('different per-case versions are accepted without pretending the queue has one version', () => {
  expect(() => assertQueueVersions(rows,{ 11:3,12:8 })).not.toThrow();
  expect(() => assertQueueVersions(rows,null,3)).toThrow('Priority queue changed');
});
test.each([{ 11:3,12:7 },{ 11:3 },{ 11:3,12:8,13:1 },[3,8],{ 11:3,12:null }])('stale or incomplete snapshot %j is rejected', versions => {
  expect(() => assertQueueVersions(rows,versions)).toThrow(expect.objectContaining({ statusCode:409,code:'PRIORITY_VERSION_CONFLICT' }));
});
test('legacy scalar remains supported for uniformly versioned clients', () => {
  expect(() => assertQueueVersions([{ procurement_case_id:11,row_version:3 }],null,3)).not.toThrow();
});
