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

const getPermissionsForRole = async (roleName) => {
  if (!roleName) return [];

  const { rows } = await pool.query(
    `SELECT p.code
       FROM roles r
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE LOWER(r.name) = LOWER($1)
      ORDER BY p.code`,
    [roleName]
  );

  return rows.map(row => row.code);
};

const getPermissionsForUserId = async (userId) => {
  const { rows } = await pool.query(
    `SELECT COALESCE(ARRAY_AGG(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
       FROM users u
       LEFT JOIN roles r ON LOWER(r.name) = LOWER(u.role)
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE u.id = $1
      GROUP BY u.id`,
    [userId]
  );

  if (rows.length === 0) {
    return [];
  }

  return rows[0].permissions || [];
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
  getPermissionsForRole,
  getPermissionsForUserId,
  userHasPermission,
  buildPermissionSet,
};