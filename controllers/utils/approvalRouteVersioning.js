const pool = require('../../config/db');

const DEFAULT_MIN_AMOUNT = 0;
const DEFAULT_MAX_AMOUNT = 999999999;

const getRunner = client => (client && typeof client.query === 'function' ? client : pool);

const ensureApprovalRouteVersioning = async client => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("../../utils/runtimeSchemaContract").assertModuleContract("controllers/utils/approvalRouteVersioning.js#ensureApprovalRouteVersioning", client);
};

const getActiveVersion = async client => {
  const runner = getRunner(client);
  const { rows } = await runner.query(
    `SELECT id, version_label, change_summary, created_at
       FROM approval_route_versions
      WHERE is_active = TRUE
      ORDER BY id DESC
      LIMIT 1`,
  );
  return rows[0] || null;
};

const listRoutesForVersion = async (client, versionId) => {
  const runner = getRunner(client);
  const { rows } = await runner.query(
    `SELECT id, request_type, department_type, approval_level, role, min_amount, max_amount, warehouse_id
       FROM approval_route_rules
      WHERE version_id = $1
      ORDER BY request_type, department_type, approval_level, id`,
    [versionId],
  );
  return rows;
};

const normalizeForStorage = route => ({
  request_type: route.request_type,
  department_type: route.department_type,
  approval_level: route.approval_level,
  role: route.role,
  min_amount: route.min_amount ?? DEFAULT_MIN_AMOUNT,
  max_amount: route.max_amount ?? DEFAULT_MAX_AMOUNT,
  warehouse_id: route.warehouse_id ? Number(route.warehouse_id) : null,
});

const createVersionFromRoutes = async (
  client,
  { routes, changeSummary, createdBy, activate = true },
) => {
  const runner = getRunner(client);

  const { rows: latestRows } = await runner.query(
    "SELECT id FROM approval_route_versions ORDER BY id DESC LIMIT 1",
  );
  const nextVersionNumber = (latestRows[0]?.id || 0) + 1;
  const versionLabel = `v${nextVersionNumber}`;

  const { rows: insertedVersionRows } = await runner.query(
    `INSERT INTO approval_route_versions (version_label, change_summary, is_active, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, version_label, change_summary, created_at`,
    [versionLabel, changeSummary || null, activate, createdBy || null],
  );

  const version = insertedVersionRows[0];

  for (const route of routes.map(normalizeForStorage)) {
    await runner.query(
      `INSERT INTO approval_route_rules
        (version_id, request_type, department_type, approval_level, role, min_amount, max_amount, warehouse_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        version.id,
        route.request_type,
        route.department_type,
        route.approval_level,
        route.role,
        route.min_amount,
        route.max_amount,
        route.warehouse_id,
      ],
    );
  }

  if (activate) {
    await runner.query(
      'UPDATE approval_route_versions SET is_active = CASE WHEN id = $1 THEN TRUE ELSE FALSE END',
      [version.id],
    );
  }

  return version;
};

module.exports = {
  ensureApprovalRouteVersioning,
  getActiveVersion,
  listRoutesForVersion,
  createVersionFromRoutes,
};