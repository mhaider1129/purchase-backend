const crypto = require('crypto');

class ApprovalRouteError extends Error { constructor(message, code, details = null, statusCode = 400) { super(message); this.name = 'ApprovalRouteError'; this.code = code; this.details = details; this.statusCode = statusCode; } }
const stable = value => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

function validateAndSnapshotRoute(route, context = {}) {
  if (!Array.isArray(route) || !route.length) throw new ApprovalRouteError('No configured approval route matched the request', 'MISSING_ROUTE');
  const steps = route.map((raw, index) => {
    const level = Number(raw.approval_level ?? raw.level ?? index + 1);
    const approverId = raw.approver_id == null ? null : Number(raw.approver_id);
    const role = String(raw.role || raw.assigned_role || '').trim() || null;
    if (!Number.isInteger(level) || level <= 0) throw new ApprovalRouteError('Route contains an invalid level', 'INVALID_ROUTE', { index });
    if (!approverId && !role) throw new ApprovalRouteError('Route step has no approver or role', 'MISSING_APPROVER', { level });
    return Object.freeze({ level, type: approverId ? 'user' : 'role', approverId: approverId || null, role, routeRuleId: raw.id || null, warehouseId: raw.warehouse_id || context.warehouseId || null });
  }).sort((a, b) => a.level - b.level);
  const seen = new Set();
  for (const step of steps) {
    const key = `${step.level}:${step.type}:${step.approverId || step.role.toLowerCase()}`;
    if (seen.has(key) || steps.filter(candidate => candidate.level === step.level).length > 1) throw new ApprovalRouteError('Route contains duplicate steps', 'DUPLICATE_ROUTE_STEP', { level: step.level });
    seen.add(key);
  }
  const snapshot = { version: 1, context: { requestType: context.requestType || null, classification: context.classification || null, departmentId: context.departmentId || null, sectionId: context.sectionId || null, instituteId: context.instituteId || null, warehouseId: context.warehouseId || null, cost: Number(context.cost || 0), itemCategory: context.itemCategory || null, maintenanceClassification: context.maintenanceClassification || null, requesterId: context.requesterId || null }, steps };
  return Object.freeze({ ...snapshot, snapshotId: crypto.createHash('sha256').update(stable(snapshot)).digest('hex') });
}

async function resolveApprovalRoute({ client, configuredRoute, ...context }) {
  let route = configuredRoute;
  if (!route && client?.query) {
    const { rows } = await client.query(
      `SELECT id, approval_level, role, approver_id, warehouse_id FROM approval_route_rules
       WHERE request_type=$1 AND department_type=$2 AND $3 >= COALESCE(min_amount,0)
       ORDER BY approval_level,id`, [context.requestType, context.classification, Number(context.cost || 0)]);
    route = rows;
  }
  return validateAndSnapshotRoute(route, context);
}

module.exports = { resolveApprovalRoute, validateAndSnapshotRoute, ApprovalRouteError };