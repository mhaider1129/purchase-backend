const { canonicalFingerprint } = require('../utils/itemFingerprint');

test('fingerprint is stable across key order, whitespace, case, and numeric representation', () => {
  const first=canonicalFingerprint({name:' Sodium  Chloride ',spec:{volume:'500.0',strength:'0.9 %'},uom:' bag '});
  const second=canonicalFingerprint({uom:'BAG',spec:{strength:'0.9 %',volume:500},name:'sodium chloride'});
  expect(first.hash).toBe(second.hash);
  expect(first.content).toBe(second.content);
});

test('fingerprint preserves clinically meaningful distinct values',()=>{
  expect(canonicalFingerprint({strength:'0.9%'}).hash).not.toBe(canonicalFingerprint({strength:'9%'}).hash);
});