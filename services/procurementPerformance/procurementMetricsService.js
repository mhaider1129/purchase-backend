'use strict';
const { summarizeTouches } = require('./procurementActivityService');

function metric(value, coverage = 'FULL', reason = null) {
  if (coverage === 'FULL') return { value, coverage };
  if (coverage === 'PARTIAL') return { value, coverage, warning: reason };
  return { value: null, coverage, status: 'not_available', reason };
}
function coverageSummary(row, domain) {
  return {
    coverage: row[`${domain}_status`],
    full_cases: Number(row[`${domain}_full_cases`]),
    partial_cases: Number(row[`${domain}_partial_cases`]),
    missing_cases: Number(row[`${domain}_missing_cases`]),
    legacy_incomplete_cases: Number(row[`${domain}_legacy_incomplete_cases`]),
    usable_evidence_cases: Number(row[`${domain}_usable_evidence_cases`]),
    total_cases: Number(row.total_cases),
    coverage_percent: row[`${domain}_coverage_percent`],
    full_coverage_percent: row[`${domain}_full_coverage_percent`],
  };
}
function aggregatePending(cases = [], now = new Date()) {
  const groups = {};
  for (const item of cases.filter(row => !['CLOSED', 'DELIVERED'].includes(row.case_status))) {
    const key = item.pending_root_cause || 'OTHER';
    const group = groups[key] ||= { count: 0, totalAgeMs: 0 };
    group.count += 1; group.totalAgeMs += now - new Date(item.opened_at);
  }
  return Object.fromEntries(Object.entries(groups).map(([key, group]) => [key, { count: group.count, averageAgeMs: group.totalAgeMs / group.count }]));
}
function buyerWorkload(cases = [], activities = []) {
  const result = {};
  for (const item of cases) {
    const buyer = item.assigned_buyer_id;
    const row = result[buyer] ||= { casesAssigned: 0, openCases: 0, completedCases: 0, workloadUnits: 0, complexityTotal: 0, highComplexityCases: 0, internationalCases: 0 };
    row.casesAssigned += 1; row.workloadUnits += item.workload_units || 0; row.complexityTotal += item.complexity_score || 0;
    if (['CLOSED', 'DELIVERED'].includes(item.case_status)) row.completedCases += 1; else row.openCases += 1;
    if (['D', 'E'].includes(item.complexity_class)) row.highComplexityCases += 1;
    if (item.international_procurement) row.internationalCases += 1;
  }
  const touches = summarizeTouches(activities);
  for (const [buyer, row] of Object.entries(result)) {
    row.averageComplexity = row.casesAssigned ? row.complexityTotal / row.casesAssigned : null;
    row.touches = activities.filter(a => String(a.actor_id) === String(buyer) && summarizeTouches([a]).total).length;
  }
  return result;
}
module.exports = { metric, coverageSummary, aggregatePending, buyerWorkload };