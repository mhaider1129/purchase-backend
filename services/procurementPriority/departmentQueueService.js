'use strict';

const { isActivePriorityCase } = require('./procurementPriorityService');

function normalizeQueue(rows) {
  return [...rows].filter(row => isActivePriorityCase(row.status))
    .sort((a, b) => (a.departmentRank ?? Number.MAX_SAFE_INTEGER) - (b.departmentRank ?? Number.MAX_SAFE_INTEGER) || String(a.id).localeCompare(String(b.id)))
    .map((row, index, all) => ({ ...row, departmentRank: index + 1, departmentRankTotal: all.length }));
}

function reorderQueue({ rows, orderedIds, actorDepartmentId, instituteId }) {
  const active = normalizeQueue(rows);
  if (active.some(row => String(row.departmentId) !== String(actorDepartmentId))) throw new Error('HOD may rank only their own department');
  if (active.some(row => String(row.instituteId) !== String(instituteId))) throw new Error('Institute scope violation');
  if (new Set(orderedIds.map(String)).size !== orderedIds.length) throw new TypeError('Duplicate queue positions are not allowed');
  const current = new Set(active.map(row => String(row.id)));
  if (orderedIds.length !== active.length || orderedIds.some(id => !current.has(String(id)))) throw new TypeError('Reorder must include every active queue item exactly once');
  const byId = new Map(active.map(row => [String(row.id), row]));
  return orderedIds.map((id, index) => ({ ...byId.get(String(id)), departmentRank: index + 1, departmentRankTotal: active.length }));
}

module.exports = { normalizeQueue, reorderQueue };