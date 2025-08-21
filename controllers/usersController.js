// controllers/usersController.js
const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

// 🚫 Deactivate user by ID
const deactivateUser = async (req, res, next) => {
  const { id } = req.params;
  const { role, id: actingUserId } = req.user;

  if (!['admin', 'SCM'].includes(role)) {
    return next(createHttpError(403, 'Only Admin or SCM can deactivate users'));
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
  let { role, department_id, section_id, can_request_medication } = req.body;

  if (!['admin', 'SCM'].includes(actingRole)) {
    return next(createHttpError(403, 'Only Admin or SCM can assign users'));
  }

    // Convert params to integers and allow null when empty
  const userId = parseInt(id, 10);
  const departmentId = department_id ? parseInt(department_id, 10) : null;
  const sectionId = section_id ? parseInt(section_id, 10) : null;
  const canRequestMedication =
    typeof can_request_medication === 'undefined'
      ? null
      : can_request_medication === true || can_request_medication === 'true';

  if (Number.isNaN(userId)) {
    return next(createHttpError(400, 'Invalid user ID'));
  }

  try {
    const result = await pool.query(
      `UPDATE users
         SET role = $1,
             department_id = $2,
             section_id = $3,
             can_request_medication = COALESCE($4, can_request_medication)
       WHERE id = $5 RETURNING id`,
      [role, departmentId, sectionId, canRequestMedication, userId]
    );
    if (result.rowCount === 0) {
      return next(createHttpError(404, 'User not found'));
    }
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Failed to assign user:', err);
    next(createHttpError(500, 'Failed to assign user'));
  }
};

module.exports = { deactivateUser, assignUser };