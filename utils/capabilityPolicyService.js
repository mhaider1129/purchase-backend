const pool = require('../config/db');
const { CAPABILITY_MATRIX, WRITE_METHODS, normalizePath } = require('../config/capabilityMatrix');

const ensureTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS route_capability_policies (
      route_prefix TEXT PRIMARY KEY,
      module TEXT NOT NULL,
      resource TEXT NOT NULL,
      permissions TEXT[] NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

const normalizePermissionList = (permissions) => {
  if (typeof permissions === 'string') {
    permissions = permissions.split(/[\s,]+/).map(code => code.trim()).filter(Boolean);
  }
  if (!Array.isArray(permissions)) return [];

  const seen = new Set();
  const normalized = [];
  for (const permission of permissions) {
    if (typeof permission !== 'string') continue;
    const code = permission.trim().toLowerCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    normalized.push(code);
  }
  return normalized;
};

const syncCapabilityPolicies = async () => {
  await ensureTable();
  for (const entry of CAPABILITY_MATRIX) {
    const permissions = normalizePermissionList(entry.permissions);
    await pool.query(
      `INSERT INTO route_capability_policies (route_prefix, module, resource, permissions)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (route_prefix) DO NOTHING`,
      [entry.routePrefix, entry.module, entry.resource, permissions]
    );
  }
};

const listCapabilityPolicies = async () => {
  await ensureTable();
  const { rows } = await pool.query(
    `SELECT route_prefix, module, resource, permissions, updated_at
       FROM route_capability_policies
      ORDER BY LENGTH(route_prefix) DESC, route_prefix ASC`
  );
  return rows.map((row) => ({
    routePrefix: row.route_prefix,
    module: row.module,
    resource: row.resource,
    permissions: Array.isArray(row.permissions) ? row.permissions.filter(Boolean) : [],
    updatedAt: row.updated_at,
  }));
};

const updateCapabilityPolicy = async (routePrefix, payload = {}) => {
  await ensureTable();
  const normalizedPrefix = typeof routePrefix === 'string' ? routePrefix.trim() : '';
  if (!normalizedPrefix) return null;

  const sets = [];
  const params = [normalizedPrefix];

  if (payload.module !== undefined) {
    params.push(String(payload.module || '').trim());
    sets.push(`module = $${params.length}`);
  }
  if (payload.resource !== undefined) {
    params.push(String(payload.resource || '').trim());
    sets.push(`resource = $${params.length}`);
  }
  if (payload.permissions !== undefined) {
    params.push(normalizePermissionList(payload.permissions));
    sets.push(`permissions = $${params.length}`);
  }

  if (sets.length === 0) {
    return null;
  }
  sets.push('updated_at = NOW()');

  const { rows } = await pool.query(
    `UPDATE route_capability_policies
        SET ${sets.join(', ')}
      WHERE route_prefix = $1
      RETURNING route_prefix, module, resource, permissions, updated_at`
    , params
  );

  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    routePrefix: row.route_prefix,
    module: row.module,
    resource: row.resource,
    permissions: Array.isArray(row.permissions) ? row.permissions.filter(Boolean) : [],
    updatedAt: row.updated_at,
  };
};

const resolveCapability = async (path = '', method = 'GET') => {
  await ensureTable();
  const normalizedPath = normalizePath(path);
  const { rows } = await pool.query(
    `SELECT route_prefix, module, resource, permissions
       FROM route_capability_policies
      WHERE $1 LIKE route_prefix || '%'
      ORDER BY LENGTH(route_prefix) DESC
      LIMIT 1`,
    [normalizedPath]
  );

  if (rows.length === 0) {
    return {
      module: 'unknown',
      resource: normalizedPath || 'unknown',
      action: WRITE_METHODS.has(String(method).toUpperCase()) ? 'write' : 'read',
      permissions: [],
    };
  }

  const row = rows[0];
  return {
    module: row.module,
    resource: row.resource,
    action: WRITE_METHODS.has(String(method).toUpperCase()) ? 'write' : 'read',
    permissions: Array.isArray(row.permissions) ? row.permissions.filter(Boolean) : [],
  };
};

module.exports = {
  syncCapabilityPolicies,
  listCapabilityPolicies,
  updateCapabilityPolicy,
  resolveCapability,
};