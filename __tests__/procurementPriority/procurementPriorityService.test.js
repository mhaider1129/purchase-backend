'use strict';

const priority = require('../../services/procurementPriority/procurementPriorityService');
const { normalizeQueue, reorderQueue } = require('../../services/procurementPriority/departmentQueueService');

const base = { impact: 'IMPORTANT_SERVICE', scmAssessment: 80, scmReason: 'Governed review', departmentRank: 1,
  departmentRankTotal: 10, agingDays: 50, serviceRisk: 'BELOW_THRESHOLD', deadline: 'TIME_SENSITIVE',
  dependency: 'DEPARTMENT_PROCESS_BLOCKED', regulatory: 'CONTRACTUAL_EXPOSURE', strategicInitiativeApproved: false };

describe('IPPS-1.0 scoring', () => {
  test('is deterministic and SCM 80 contributes 16 points', () => {
    expect(priority.calculatePriority(base)).toEqual(priority.calculatePriority({ ...base, purchaseValue: 999999, complexity: 100, pwu: 500 }));
    expect(priority.calculatePriority(base).breakdown.scmAssessment).toBe('16.00');
  });
  test('maximum is exactly 100 and P0 requires justification', () => {
    const maximum = { ...base, impact: 'PATIENT_SAFETY_OR_ESSENTIAL_SERVICE', scmAssessment: 100,
      departmentRank: 1, departmentRankTotal: 1, agingDays: 1000, serviceRisk: 'OUT_OF_STOCK',
      deadline: 'FIXED_CRITICAL', dependency: 'MAJOR_INSTITUTIONAL_DEPENDENCY',
      regulatory: 'REGULATORY_OR_AUTHORIZATION_RISK', strategicInitiativeApproved: true };
    expect(() => priority.calculatePriority(maximum)).toThrow(/P0 justification/);
    expect(priority.calculatePriority({ ...maximum, p0Justification: 'Essential service outage' }).score).toBe('100.00');
  });
  test('rank is relative, aging caps, and strategy requires approval', () => {
    expect(priority.departmentRankPoints(2, 3)).not.toBe(priority.departmentRankPoints(2, 30));
    expect(priority.agingPoints(9999)).toBe(10);
    expect(priority.calculatePriority({ ...base, strategicInitiativeApproved: false }).breakdown.strategic).toBe('0.00');
    expect(priority.calculatePriority({ ...base, strategicInitiativeApproved: true }).breakdown.strategic).toBe('3.00');
  });
  test('system rank is deterministic and override leaves score untouched', () => {
    const ordered = priority.suggestInstitutionalOrder([{ procurementCaseId: 2, scoreUnits: 4000 }, { procurementCaseId: 1, scoreUnits: 7000 }]);
    expect(ordered.map(x => x.procurementCaseId)).toEqual([1, 2]);
    expect(() => priority.applyInstitutionalRankOverride(ordered[0], 2, '')).toThrow(/reason/);
    expect(priority.applyInstitutionalRankOverride(ordered[0], 2, 'Dependency sequencing').scoreUnits).toBe(7000);
  });
  test('groups use maximum active score and close when all members terminal', () => {
    expect(priority.deriveGroupPriority([{ status: 'Closed', scoreUnits: 9900 }, { status: 'In Progress', scoreUnits: 7500 }])).toMatchObject({ active: true, scoreUnits: 7500, tier: 'P1' });
    expect(priority.deriveGroupPriority([{ status: 'Received', scoreUnits: 9900 }]).active).toBe(false);
  });
});

describe('department queue', () => {
  const rows = [{ id: 'a', departmentId: 7, instituteId: 1, status: 'Approved', departmentRank: 2 },
    { id: 'b', departmentId: 7, instituteId: 1, status: 'In Progress', departmentRank: 1 },
    { id: 'done', departmentId: 7, instituteId: 1, status: 'Completed', departmentRank: 3 }];
  test('returns active rows and normalizes without gaps', () => expect(normalizeQueue(rows).map(x => [x.id, x.departmentRank])).toEqual([['b', 1], ['a', 2]]));
  test('reorders the complete active queue without duplicate positions', () => {
    expect(reorderQueue({ rows, orderedIds: ['a', 'b'], actorDepartmentId: 7, instituteId: 1 }).map(x => x.id)).toEqual(['a', 'b']);
    expect(() => reorderQueue({ rows, orderedIds: ['a', 'a'], actorDepartmentId: 7, instituteId: 1 })).toThrow(/Duplicate/);
  });
  test('enforces department and institute scope', () => {
    expect(() => reorderQueue({ rows, orderedIds: ['a', 'b'], actorDepartmentId: 8, instituteId: 1 })).toThrow(/own department/);
    expect(() => reorderQueue({ rows, orderedIds: ['a', 'b'], actorDepartmentId: 7, instituteId: 2 })).toThrow(/Institute/);
  });
});