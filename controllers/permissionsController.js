const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const { buildPermissionSet, getPermissionsForUserId } = require('../utils/permissionService');

const ensureCanManagePermissions = (req) => {
  if (!req.user?.hasPermission?.('permissions.manage')) {
    throw createHttpError(403, 'You do not have permission to manage user permissions');
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

const getUserPermissions = async (req, res, next) => {
  const userId = Number.parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return next(createHttpError(400, 'Invalid user identifier'));
  }

  try {
    ensureCanManagePermissions(req);
  } catch (err) {
    return next(err);
  }

  try {
    const { permissions, found } = await getPermissionsForUserId(userId);

    if (!found) {
      return next(createHttpError(404, 'User not found'));
    }

    res.json({
      user_id: userId,
      permissions,
    });
  } catch (err) {
    console.error(`❌ Failed to load permissions for user ${userId}:`, err);
    next(createHttpError(500, 'Failed to load user permissions'));
  }
};

const updateUserPermissions = async (req, res, next) => {
  const userId = Number.parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return next(createHttpError(400, 'Invalid user identifier'));
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

    const { rowCount: userExists } = await client.query(
      'SELECT 1 FROM users WHERE id = $1',
      [userId]
    );

    if (userExists === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'User not found'));
    }

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

    await client.query('DELETE FROM user_permissions WHERE user_id = $1', [userId]);

    for (const permissionId of validPermissionIds) {
      await client.query(
        `INSERT INTO user_permissions (user_id, permission_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [userId, permissionId]
      );
    }

    await client.query('COMMIT');

    const updatedPermissions = permissionCodes.sort();
    res.json({
      user_id: userId,
      permissions: updatedPermissions,
      permission_set: Array.from(buildPermissionSet(updatedPermissions)),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`❌ Failed to update permissions for user ${userId}:`, err);
    next(createHttpError(500, 'Failed to update user permissions'));
  } finally {
    client.release();
  }
};

module.exports = {
  listPermissions,
  getUserPermissions,
  updateUserPermissions,
};