const pool = require('../config/db');

const normalizeRoleKey = (role) =>
  (role || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '');

const DEFAULT_ROLE_PERMISSIONS = {
  requester: ['stock-requests.create'],
  technician: ['warehouse.manage-supply', 'warehouse.view-supply', 'stock-requests.create'],
  warehousemanager: ['warehouse.manage-supply', 'warehouse.view-supply', 'stock-requests.create'],
  warehousekeeper: ['warehouse.manage-supply', 'warehouse.view-supply'],
  scm: [
    'approvals.reassign',
    'contracts.manage',
    'departments.manage',
    'evaluations.manage',
    'permissions.manage',
    'procurement.update-cost',
    'procurement.update-status',
    'projects.manage',
    'recalls.manage',
    'recalls.view',
    'requests.manage',
    'requests.view-all',
    'requests.view-incomplete',
    'stock-requests.review',
    'users.manage',
    'warehouse.manage-supply',
    'warehouse.view-supply',
    'dashboard.view',
  ],
  procurementspecialist: [
    'contracts.manage',
    'evaluations.manage',
    'procurement.update-cost',
    'procurement.update-status',
    'requests.manage',
    'requests.view-all',
    'requests.view-incomplete',
  ],
  contractmanager: ['contracts.manage', 'evaluations.manage'],
  medicaldevices: ['contracts.manage'],
  audit: ['requests.view-incomplete', 'requests.view-audit'],
  coo: ['requests.view-incomplete', 'requests.view-audit'],
  cmo: ['requests.view-incomplete', 'requests.view-audit'],
};

const getDefaultPermissionsForRole = (role) => {
  const key = normalizeRoleKey(role);
  const permissions = DEFAULT_ROLE_PERMISSIONS[key];
  if (!Array.isArray(permissions)) {
    return [];
  }
  return permissions
    .map((code) => (typeof code === 'string' ? code.trim().toLowerCase() : ''))
    .filter(Boolean);
};

const ensurePermissionTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS permissions (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_permissions (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, permission_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    )
  `);
};

const syncPermissionCatalog = async () => {
  // Permissions are now managed directly in the database (Supabase).
  // We only need to ensure the required tables exist; seeding happens externally.
  await ensurePermissionTables();
};

const getAllPermissionCodes = async () => {
  const { rows } = await pool.query(
    `SELECT code
       FROM permissions
      ORDER BY code`
  );

  return rows.map(row => row.code);
};

const getPermissionsForUserId = async (userId) => {
  const { rows } = await pool.query(
    `SELECT u.role,
            COALESCE(ARRAY_AGG(DISTINCT p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
       FROM users u
       LEFT JOIN user_permissions up ON up.user_id = u.id
       LEFT JOIN permissions p ON p.id = up.permission_id
      WHERE u.id = $1
      GROUP BY u.id, u.role`,
    [userId]
  );

  if (rows.length === 0) {
    return { permissions: [], found: false };
  }

  const { role, permissions } = rows[0];
  const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';

  if (normalizedRole === 'admin') {
    const allPermissions = await getAllPermissionCodes();
    return { permissions: allPermissions, role, found: true };
  }

  return { permissions: permissions || [], role, found: true };
};

const buildPermissionSet = (permissions) => {
  const set = new Set();
  for (const permission of permissions || []) {
    if (permission) {
      set.add(permission.toLowerCase());
    }
  }
  return set;
};

const userHasPermission = (user, permissionCode) => {
  if (!user || !permissionCode) {
    return false;
  }

  const normalized = permissionCode.toLowerCase();
  if (!user.permissionSet) {
    user.permissionSet = buildPermissionSet(user.permissions);
  }

  return user.permissionSet.has(normalized);
};

const applyDefaultRolePermissions = async (userId, role, options = {}) => {
  const {
    client: providedClient = null,
    replaceExisting = false,
    skipIfExists = true,
  } = options;

  if (!Number.isInteger(userId)) {
    throw new Error('applyDefaultRolePermissions requires a valid numeric userId');
  }

  const defaultPermissions = getDefaultPermissionsForRole(role);
  if (defaultPermissions.length === 0) {
    return { applied: false, reason: 'no-defaults', missing: [] };
  }

  let client = providedClient;
  let releaseOnExit = false;
  if (!client) {
    client = await pool.connect();
    releaseOnExit = true;
  }

  let result = { applied: false, reason: 'no-op', missing: [] };
  try {
    if (!replaceExisting && skipIfExists) {
      const existing = await client.query(
        'SELECT 1 FROM user_permissions WHERE user_id = $1 LIMIT 1',
        [userId]
      );
      if (existing.rowCount > 0) {
        result = { applied: false, reason: 'existing-permissions', missing: [] };
        return result;
      }
    }

    if (replaceExisting) {
      await client.query('DELETE FROM user_permissions WHERE user_id = $1', [userId]);
    }

    const normalizedCodes = Array.from(new Set(defaultPermissions));

    if (normalizedCodes.length === 0) {
      result = { applied: false, reason: 'no-valid-permissions', missing: [] };
      return result;
    }

    const { rows } = await client.query(
      `SELECT id, LOWER(code) AS code FROM permissions WHERE LOWER(code) = ANY($1::TEXT[])`,
      [normalizedCodes]
    );

    const codeToId = new Map(rows.map((row) => [row.code, row.id]));
    const permissionIds = [];
    const missing = [];

    for (const code of normalizedCodes) {
      const id = codeToId.get(code);
      if (!id) {
        missing.push(code);
        continue;
      }
      permissionIds.push(id);
    }

    if (permissionIds.length > 0) {
      await client.query(
        `INSERT INTO user_permissions (user_id, permission_id)
         SELECT $1, permission_id
           FROM UNNEST($2::INT[]) AS permission_id
         ON CONFLICT DO NOTHING`,
        [userId, permissionIds]
      );
    }

    if (missing.length > 0) {
      console.warn(
        `⚠️ Missing permission definitions for role '${role}': ${missing.join(', ')}`
      );
    }

    result = {
      applied: permissionIds.length > 0,
      reason: permissionIds.length > 0 ? 'applied' : 'no-permissions-found',
      missing,
    };
    return result;
  } finally {
    if (releaseOnExit && client && typeof client.release === 'function') {
      client.release();
    }
  }
};

module.exports = {
  syncPermissionCatalog,
  getAllPermissionCodes,
  getPermissionsForUserId,
  userHasPermission,
  buildPermissionSet,
  getDefaultPermissionsForRole,
  applyDefaultRolePermissions,
};