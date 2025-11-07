const pool = require('../config/db');

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

module.exports = {
  syncPermissionCatalog,
  getAllPermissionCodes,
  getPermissionsForUserId,
  userHasPermission,
  buildPermissionSet,
};