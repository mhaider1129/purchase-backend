'use strict';

const { MODEL_VERSION, SCALE, WEIGHTS, FACTORS, TERMINAL_STATUSES } = require('./constants');

const points = value => Math.round(value * SCALE);
const requireEnum = (group, value) => {
  if (!Object.hasOwn(group, value)) throw new TypeError(`Unsupported controlled factor: ${value}`);
  return group[value];
};

function agingPoints(days) {
  if (!Number.isInteger(days) || days < 0) throw new TypeError('agingDays must be a non-negative integer');
  if (days <= 14) return 0;
  if (days <= 30) return 2;
  if (days <= 45) return 4;
  if (days <= 60) return 6;
  if (days <= 90) return 8;
  return 10;
}

function departmentRankPoints(rank, total) {
  if (!Number.isInteger(rank) || !Number.isInteger(total) || total < 1 || rank < 1 || rank > total) {
    throw new TypeError('Department rank must be an integer within the active queue total');
  }
  if (total === 1) return points(WEIGHTS.departmentRank);
  return Math.round(((total - rank) * WEIGHTS.departmentRank * SCALE) / (total - 1));
}

function tierFor(scoreUnits) {
  if (scoreUnits >= points(90)) return 'P0';
  if (scoreUnits >= points(75)) return 'P1';
  if (scoreUnits >= points(60)) return 'P2';
  if (scoreUnits >= points(40)) return 'P3';
  return 'P4';
}

function calculatePriority(input) {
  const scm = input.scmAssessment;
  if (!Number.isInteger(scm) || scm < 0 || scm > 100) throw new TypeError('SCM assessment must be an integer from 0 to 100');
  if (!String(input.scmReason || '').trim()) throw new TypeError('SCM assessment reason is required');
  const strategic = input.strategicInitiativeApproved === true ? points(WEIGHTS.strategic) : 0;
  const breakdown = {
    impact: points(requireEnum(FACTORS.impact, input.impact)),
    scmAssessment: Math.round((scm * WEIGHTS.scmAssessment * SCALE) / 100),
    departmentRank: departmentRankPoints(input.departmentRank, input.departmentRankTotal),
    aging: points(agingPoints(input.agingDays)),
    serviceRisk: points(requireEnum(FACTORS.serviceRisk, input.serviceRisk)),
    deadline: points(requireEnum(FACTORS.deadline, input.deadline)),
    dependency: points(requireEnum(FACTORS.dependency, input.dependency)),
    regulatory: points(requireEnum(FACTORS.regulatory, input.regulatory)),
    strategic,
  };
  const scoreUnits = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  if (scoreUnits > points(100)) throw new Error('Priority score exceeded governed maximum');
  const tier = tierFor(scoreUnits);
  if (tier === 'P0' && !String(input.p0Justification || '').trim()) throw new TypeError('P0 justification is required');
  return Object.freeze({ modelVersion: MODEL_VERSION, scoreUnits, score: (scoreUnits / SCALE).toFixed(2), tier,
    breakdown: Object.freeze(Object.fromEntries(Object.entries(breakdown).map(([key, value]) => [key, (value / SCALE).toFixed(2)]))) });
}

const isActivePriorityCase = status => !TERMINAL_STATUSES.has(String(status || '').trim().toUpperCase());

function deriveGroupPriority(members) {
  const active = members.filter(member => isActivePriorityCase(member.status));
  if (!active.length) return { active: false, scoreUnits: null, tier: null };
  const scoreUnits = Math.max(...active.map(member => member.scoreUnits));
  return { active: true, scoreUnits, tier: tierFor(scoreUnits) };
}

function suggestInstitutionalOrder(profiles) {
  return [...profiles].sort((a, b) => b.scoreUnits - a.scoreUnits || String(a.procurementCaseId).localeCompare(String(b.procurementCaseId)))
    .map((profile, index) => ({ ...profile, systemSuggestedRank: index + 1 }));
}

function applyInstitutionalRankOverride(profile, institutionalRank, reason) {
  if (!Number.isInteger(institutionalRank) || institutionalRank < 1) throw new TypeError('Institutional rank must be positive');
  if (!String(reason || '').trim()) throw new TypeError('Institutional rank override reason is required');
  return { ...profile, institutionalRank, institutionalRankOverrideReason: reason.trim() };
}

module.exports = { calculatePriority, agingPoints, departmentRankPoints, tierFor, isActivePriorityCase,
  deriveGroupPriority, suggestInstitutionalOrder, applyInstitutionalRankOverride };