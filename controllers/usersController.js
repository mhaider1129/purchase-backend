// controllers/usersController.js
const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const { applyDefaultRolePermissions } = require('../utils/permissionService');

// 🚫 Deactivate user by ID
const deactivateUser = async (req, res, next) => {
  const { id } = req.params;
  const { role, id: actingUserId } = req.user;

  if (!req.user.hasPermission('users.manage')) {
    return next(createHttpError(403, 'You do not have permission to deactivate users'));
  }

  try {
    // 🔍 Check if user exists
    const userRes = await pool.query('SELECT id, is_active, name FROM users WHERE id = $1', [id]);
    if (userRes.rowCount === 0) {
      return next(createHttpError(404, 'User not found'));
    }

    const user = userRes.rows[0];

    if (!user.is_active) {
      return res.status(200).json({
        success: true,
        message: `ℹ️ User ID ${id} (${user.name}) is already deactivated`,
      });
    }

    // 🛑 Deactivate the user
    await pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [id]);

    // 📝 Log deactivation in audit table (if implemented)
    await pool.query(
      `
      INSERT INTO audit_logs (action, actor_id, target_id, description)
      VALUES ('User Deactivated', $1, $2, $3)
    `,
      [actingUserId, id, `User ${user.name} (ID ${id}) was deactivated`]
    );

    res.status(200).json({
      success: true,
      message: `✅ User ID ${id} (${user.name}) deactivated successfully`,
    });
  } catch (err) {
    console.error('❌ Failed to deactivate user:', err);
    next(createHttpError(500, 'Failed to deactivate user'));
  }
};

const assignUser = async (req, res, next) => {
  const { id } = req.params;
  const { role: actingRole } = req.user;
  const { role, role_id, department_id, section_id, can_request_medication } = req.body;

  if (!req.user.hasPermission('users.manage')) {
    return next(createHttpError(403, 'You do not have permission to manage users'));
  }

  const userId = parseInt(id, 10);
  if (Number.isNaN(userId)) {
    return next(createHttpError(400, 'Invalid user ID'));
  }

  let departmentId = null;
  if (typeof department_id !== 'undefined' && department_id !== null && department_id !== '') {
    departmentId = parseInt(department_id, 10);
    if (Number.isNaN(departmentId)) {
      return next(createHttpError(400, 'Invalid department ID'));
    }
  }

  let sectionId = null;
  if (typeof section_id !== 'undefined' && section_id !== null && section_id !== '') {
    sectionId = parseInt(section_id, 10);
    if (Number.isNaN(sectionId)) {
      return next(createHttpError(400, 'Invalid section ID'));
    }
  }

  const shouldUpdateMedication = typeof can_request_medication !== 'undefined';
  let parsedMedicationValue = null;
  if (shouldUpdateMedication) {
    if (typeof can_request_medication === 'boolean') {
      parsedMedicationValue = can_request_medication;
    } else if (typeof can_request_medication === 'string') {
      const normalized = can_request_medication.trim().toLowerCase();
      if (normalized === 'true' || normalized === 'false') {
        parsedMedicationValue = normalized === 'true';
      } else {
        return next(createHttpError(400, 'can_request_medication must be a boolean value'));
      }
    } else {
      return next(createHttpError(400, 'can_request_medication must be a boolean value'));
    }
  }

  try {
    const userRes = await pool.query(
      `SELECT id, role FROM users WHERE id = $1`,
      [userId]
    );

    if (userRes.rowCount === 0) {
      return next(createHttpError(404, 'User not found'));
    }

    const existingUser = userRes.rows[0];
    if (existingUser.role === 'admin' && actingRole !== 'admin') {
      return next(createHttpError(403, 'Only Admin can modify other Admin accounts'));
    }

    const roleProvided = typeof role !== 'undefined' || typeof role_id !== 'undefined';
    let targetRoleName = existingUser.role;
    let roleNameFromId = null;

    if (typeof role_id !== 'undefined') {
      const parsedRoleId = parseInt(role_id, 10);
      if (Number.isNaN(parsedRoleId)) {
        return next(createHttpError(400, 'Invalid role ID'));
      }
      const roleRes = await pool.query('SELECT name FROM roles WHERE id = $1', [parsedRoleId]);
      if (roleRes.rowCount === 0) {
        return next(createHttpError(400, 'Invalid role specified'));
      }
      roleNameFromId = roleRes.rows[0].name;
      targetRoleName = roleNameFromId;
    }

    if (typeof role !== 'undefined') {
      const normalizedRole = String(role).trim();
      if (!normalizedRole) {
        return next(createHttpError(400, 'Role cannot be empty'));
      }
      if (roleNameFromId && roleNameFromId !== normalizedRole) {
        return next(createHttpError(400, 'Provided role does not match the supplied role ID'));
      }
      if (!roleNameFromId) {
        const roleRes = await pool.query('SELECT id FROM roles WHERE name = $1', [normalizedRole]);
        if (roleRes.rowCount === 0) {
          return next(createHttpError(400, 'Invalid role specified'));
        }
      }
      targetRoleName = normalizedRole;
    }

    const roleChanged = roleProvided && targetRoleName !== existingUser.role;

    if (roleProvided) {
      const privilegedRoles = ['admin'];
      if (privilegedRoles.includes(targetRoleName) && actingRole !== 'admin') {
        return next(createHttpError(403, 'Only Admin can assign privileged roles'));
      }
    }

    const result = await pool.query(
      `UPDATE users
         SET role = $1,
             department_id = $2,
             section_id = $3,
             can_request_medication = COALESCE($4::BOOLEAN, can_request_medication)
       WHERE id = $5 RETURNING id`,
      [
        targetRoleName,
        departmentId,
        sectionId,
        shouldUpdateMedication ? parsedMedicationValue : null,
        userId,
      ]
    );

    if (result.rowCount === 0) {
      return next(createHttpError(404, 'User not found'));
    }

    if (roleChanged) {
      await applyDefaultRolePermissions(userId, targetRoleName, {
        replaceExisting: true,
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Failed to assign user:', err);
    next(createHttpError(500, 'Failed to assign user'));
  }
};

const getAllByRole = async (role) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE role = $1', [role]);
    return rows;
  } catch (err) {
    console.error(`❌ Failed to get users by role ${role}:`, err);
    throw new Error(`Failed to get users by role ${role}`);
  }
};

module.exports = { deactivateUser, assignUser, getAllByRole };