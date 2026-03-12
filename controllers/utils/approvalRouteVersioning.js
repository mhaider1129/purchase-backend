const pool = require('../../config/db');

const DEFAULT_MIN_AMOUNT = 0;
const DEFAULT_MAX_AMOUNT = 999999999;

const getRunner = client => (client && typeof client.query === 'function' ? client : pool);

const ensureApprovalRouteVersioning = async client => {
  const runner = getRunner(client);

  await runner.query(`
    CREATE TABLE IF NOT EXISTS approval_route_versions (
      id SERIAL PRIMARY KEY,
      version_label VARCHAR(120) NOT NULL,
      change_summary TEXT,
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      created_by INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await runner.query(`
    CREATE TABLE IF NOT EXISTS approval_route_rules (
      id SERIAL PRIMARY KEY,
      version_id INTEGER NOT NULL REFERENCES approval_route_versions(id) ON DELETE CASCADE,
      request_type VARCHAR(50) NOT NULL,
      department_type VARCHAR(50) NOT NULL,
      approval_level INTEGER NOT NULL,
      role VARCHAR(50) NOT NULL,
      min_amount BIGINT DEFAULT ${DEFAULT_MIN_AMOUNT},
      max_amount BIGINT DEFAULT ${DEFAULT_MAX_AMOUNT}
    )
  `);

  await runner.query(
    'CREATE INDEX IF NOT EXISTS approval_route_rules_lookup_idx ON approval_route_rules (version_id, request_type, department_type, approval_level)'
  );

  const { rows: versions } = await runner.query('SELECT id FROM approval_route_versions ORDER BY id LIMIT 1');
  if (versions.length > 0) {
    return;
  }

  const baseVersionLabel = 'v1';
  const { rows: insertedVersion } = await runner.query(
    `INSERT INTO approval_route_versions (version_label, change_summary, is_active)
     VALUES ($1, $2, TRUE)
     RETURNING id`,
    [baseVersionLabel, 'Initial baseline imported from approval_routes'],
  );

  const baselineVersionId = insertedVersion[0].id;
  await runner.query(
    `INSERT INTO approval_route_rules
      (version_id, request_type, department_type, approval_level, role, min_amount, max_amount)
     SELECT $1, request_type, department_type, approval_level, role,
            COALESCE(min_amount, $2), COALESCE(max_amount, $3)
       FROM approval_routes`,
    [baselineVersionId, DEFAULT_MIN_AMOUNT, DEFAULT_MAX_AMOUNT],
  );
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
    `SELECT id, request_type, department_type, approval_level, role, min_amount, max_amount
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
        (version_id, request_type, department_type, approval_level, role, min_amount, max_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        version.id,
        route.request_type,
        route.department_type,
        route.approval_level,
        route.role,
        route.min_amount,
        route.max_amount,
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