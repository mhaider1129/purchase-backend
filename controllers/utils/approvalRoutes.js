
const pool = require('../../config/db');
const {
  ensureApprovalRouteVersioning,
  getActiveVersion,
} = require('./approvalRouteVersioning');

const DEFAULT_MIN_AMOUNT = 0;
const DEFAULT_MAX_AMOUNT = 999999999;

const getQueryRunner = client =>
  client && typeof client.query === 'function' ? client : pool;

const normalizeDepartmentType = value => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
};

const normalizeAmount = value => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return DEFAULT_MIN_AMOUNT;
  }
  return Math.trunc(numeric);
};

const fetchApprovalRoutes = async ({
  client,
  requestType,
  departmentType,
  amount = DEFAULT_MIN_AMOUNT,
}) => {
  const runner = getQueryRunner(client);
  const normalizedRequestType =
    typeof requestType === 'string' ? requestType.trim() : '';
  const normalizedDepartmentType = normalizeDepartmentType(departmentType);

  if (!normalizedRequestType || !normalizedDepartmentType) {
    return [];
  }

  const numericAmount = normalizeAmount(amount);

  await ensureApprovalRouteVersioning(runner);
  const activeVersion = await getActiveVersion(runner);

  if (!activeVersion) {
    return [];
  }

  const { rows } = await runner.query(
    `SELECT id, request_type, department_type, approval_level, role, min_amount, max_amount
       FROM approval_route_rules
      WHERE version_id = $1
        AND request_type = $2
        AND department_type = $3
        AND $4 BETWEEN COALESCE(min_amount, $5) AND COALESCE(max_amount, $6)
      ORDER BY approval_level, id`,
    [
      activeVersion.id,
      normalizedRequestType,
      normalizedDepartmentType,
      numericAmount,
      DEFAULT_MIN_AMOUNT,
      DEFAULT_MAX_AMOUNT,
    ],
  );

  return rows;
};

const resolveDepartmentType = async (client, departmentId) => {
  const runner = getQueryRunner(client);
  if (!departmentId) {
    return null;
  }
  const parsedId = Number(departmentId);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return null;
  }
  const { rows } = await runner.query(
    `SELECT type
       FROM departments
      WHERE id = $1
      LIMIT 1`,
    [parsedId],
  );
  const deptType = rows[0]?.type;
  return deptType ? deptType.trim().toLowerCase() : null;
};

const resolveRouteDomain = async ({
  client,
  departmentId,
  explicitDomain,
  requestType,
}) => {
  const normalizedExplicit = normalizeDepartmentType(explicitDomain) || '';
  const deptType = await resolveDepartmentType(client, departmentId);

  if (requestType === 'Warehouse Supply') {
    return normalizedExplicit || deptType || 'operational';
  }

  return deptType || normalizedExplicit || 'operational';
};

module.exports = {
  DEFAULT_MIN_AMOUNT,
  DEFAULT_MAX_AMOUNT,
  fetchApprovalRoutes,
  resolveRouteDomain,
};