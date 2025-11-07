const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const { buildPermissionSet } = require('../utils/permissionService');

const ensureCanManagePermissions = (req) => {
  if (!req.user?.hasPermission?.('permissions.manage')) {
    throw createHttpError(403, 'You do not have permission to manage role permissions');
  }
};

const listPermissions = async (req, res, next) => {
  try {
    ensureCanManagePermissions(req);
  } catch (err) {
    return next(err);
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, code, name, description
         FROM permissions
        ORDER BY code`
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to list permissions:', err);
    next(createHttpError(500, 'Failed to load permissions'));
  }
};

const getRolePermissions = async (req, res, next) => {
  const roleId = Number.parseInt(req.params.roleId, 10);
  if (!Number.isInteger(roleId) || roleId <= 0) {
    return next(createHttpError(400, 'Invalid role identifier'));
  }

  try {
    ensureCanManagePermissions(req);
  } catch (err) {
    return next(err);
  }

  try {
    const { rows } = await pool.query(
      `SELECT p.code
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1
        ORDER BY p.code`,
      [roleId]
    );

    res.json({
      role_id: roleId,
      permissions: rows.map(row => row.code),
    });
  } catch (err) {
    console.error(`❌ Failed to load permissions for role ${roleId}:`, err);
    next(createHttpError(500, 'Failed to load role permissions'));
  }
};

const updateRolePermissions = async (req, res, next) => {
  const roleId = Number.parseInt(req.params.roleId, 10);
  if (!Number.isInteger(roleId) || roleId <= 0) {
    return next(createHttpError(400, 'Invalid role identifier'));
  }

  let permissionCodes = req.body?.permissions || req.body?.permissionCodes;
  if (!Array.isArray(permissionCodes)) {
    permissionCodes = [];
  }

  permissionCodes = permissionCodes
    .map(code => (typeof code === 'string' ? code.trim() : ''))
    .filter(Boolean);

  try {
    ensureCanManagePermissions(req);
  } catch (err) {
    return next(err);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: allPermissions } = await client.query(
      'SELECT id, code FROM permissions'
    );

    const codeToId = new Map(allPermissions.map(row => [row.code, row.id]));
    const validPermissionIds = [];

    for (const code of permissionCodes) {
      if (!codeToId.has(code)) {
        await client.query('ROLLBACK');
        return next(createHttpError(400, `Unknown permission code: ${code}`));
      }
      validPermissionIds.push(codeToId.get(code));
    }

    await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);

    for (const permissionId of validPermissionIds) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [roleId, permissionId]
      );
    }

    await client.query('COMMIT');

    const updatedPermissions = permissionCodes.sort();
    res.json({
      role_id: roleId,
      permissions: updatedPermissions,
      permission_set: Array.from(buildPermissionSet(updatedPermissions)),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`❌ Failed to update permissions for role ${roleId}:`, err);
    next(createHttpError(500, 'Failed to update role permissions'));
  } finally {
    client.release();
  }
};

module.exports = {
  listPermissions,
  getRolePermissions,
  updateRolePermissions,
};