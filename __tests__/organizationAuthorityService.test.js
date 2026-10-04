const { createOrganizationAuthorityService, isCurrentPosition } = require('../services/organizationAuthorityService');

beforeAll(() => jest.useFakeTimers().setSystemTime(new Date('2026-10-03T12:00:00Z')));
afterAll(() => jest.useRealTimers());

const units = [
  { id: 1, name: 'Institute', unit_type: 'INSTITUTE', parent_unit_id: null, institute_id: 7 },
  { id: 92, name: 'COO', unit_type: 'EXECUTIVE_OFFICE', parent_unit_id: 1, institute_id: 7 },
  { id: 93, name: 'CMO', unit_type: 'EXECUTIVE_OFFICE', parent_unit_id: 1, institute_id: 7 },
  { id: 96, name: 'CFO', unit_type: 'EXECUTIVE_OFFICE', parent_unit_id: 1, institute_id: 7 },
  { id: 21, name: 'Supply Chain', unit_type: 'DEPARTMENT', parent_unit_id: 92, institute_id: 7 },
  { id: 30, name: 'Pharmacy', unit_type: 'DEPARTMENT', parent_unit_id: 93, institute_id: 7, classification: 'Operational' },
  { id: 31, name: 'Nursing', unit_type: 'DEPARTMENT', parent_unit_id: 92, institute_id: 7, classification: 'Medical' }
];
const basePositions = [
  { id: 192, organization_unit_id: 92, position_type: 'EXECUTIVE_HEAD', position_name: 'COO', user_id: 2, user_name: 'Omar Zeyad', user_is_active: true, is_unit_head: true, is_active: true, effective_from: '2026-04-28', effective_to: null },
  { id: 193, organization_unit_id: 93, position_type: 'EXECUTIVE_HEAD', position_name: 'CMO', user_id: 3, user_name: 'Hassanin Muiz Mohammed', user_is_active: true, is_unit_head: true, is_active: true, effective_from: '2026-04-28', effective_to: null },
  { id: 196, organization_unit_id: 96, position_type: 'EXECUTIVE_HEAD', position_name: 'CFO', user_id: 22, user_name: 'Muntadher Mudher', user_is_active: true, is_unit_head: true, is_active: true, effective_to: null },
  { id: 121, organization_unit_id: 21, position_type: 'DEPARTMENT_HEAD', position_name: 'Supply Chain Manager', user_id: 1, user_name: 'Mohammed Haider Kamal', user_is_active: true, is_unit_head: true, is_active: true, effective_to: null }
];

function fixture(extraPositions = []) {
  const positions = [...basePositions, ...extraPositions];
  const get = async id => units.find(unit => String(unit.id) === String(id));
  const ancestors = async id => {
    const result=[]; let unit=await get(id);
    while(unit?.parent_unit_id){unit=await get(unit.parent_unit_id);result.unshift(unit);}
    return result;
  };
  return createOrganizationAuthorityService({ get, ancestors, positions: async id => positions.filter(position => String(position.organization_unit_id) === String(id)) });
}

test.each([[93,3],[92,2],[96,22],[21,1]])('unit %s resolves its flagged current head user %s',async(unitId,userId)=>{
  expect(await fixture().resolveUnitHead(unitId,7)).toMatchObject({status:'RESOLVED',organizationUnitId:unitId,userId});
});

test('executive owner follows ancestry, not department classification',async()=>{
  expect(await fixture().resolveExecutiveOwner(30,7)).toMatchObject({status:'RESOLVED',organizationUnitId:93,userId:3});
  expect(await fixture().resolveExecutiveOwner(21,7)).toMatchObject({status:'RESOLVED',organizationUnitId:92,userId:2});
  expect(await fixture().resolveExecutiveOwner(31,7)).toMatchObject({status:'RESOLVED',organizationUnitId:92,userId:2});
});

test('current-position boundaries include an open end and exclude expired, future, and inactive rows',()=>{
  expect(isCurrentPosition({is_active:true,effective_from:'2026-01-01',effective_to:null},'2026-10-03')).toBe(true);
  expect(isCurrentPosition({is_active:true,effective_to:'2026-10-02'},'2026-10-03')).toBe(false);
  expect(isCurrentPosition({is_active:true,effective_from:'2026-10-04'},'2026-10-03')).toBe(false);
  expect(isCurrentPosition({is_active:false,effective_to:null},'2026-10-03')).toBe(false);
});

test('duplicate current flagged heads are explicit and fail closed',async()=>{
  const result=await fixture([{...basePositions[1],id:999,user_id:4,user_name:'Duplicate'}]).resolveUnitHead(93,7);
  expect(result).toMatchObject({status:'AMBIGUOUS',positionIds:[193,999]});
  expect(result.userId).toBeUndefined();
});

test('cross-institute unit references do not resolve',async()=>{
  expect(await fixture().resolveUnitHead(93,8)).toEqual({status:'UNASSIGNED',organizationUnitId:93});
});
