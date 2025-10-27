// controllers/adminToolsController.js
const pool = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseFormatter');

const ALLOWED_ROLES = new Set(['admin', 'SCM']);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 🚫 Deactivate a user by email via the Admin Tools page
const deactivateUserByEmail = async (req, res) => {
  const { email } = req.body || {};
  const actingUser = req.user || {};
  const actingRole = actingUser.role;
  const actingUserId = actingUser.id;

  if (!ALLOWED_ROLES.has(actingRole)) {
    return errorResponse(res, 403, 'Only Admin or SCM can deactivate users');
  }

  if (typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    return errorResponse(res, 400, 'A valid email address is required');
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const userRes = await pool.query(
      `SELECT id, name, email, is_active
         FROM users
        WHERE LOWER(email) = $1
        LIMIT 1`,
      [normalizedEmail]
    );

    if (userRes.rowCount === 0) {
      return errorResponse(res, 404, `No user found with email ${normalizedEmail}`);
    }

    const targetUser = userRes.rows[0];

    if (!targetUser.is_active) {
      return successResponse(
        res,
        `ℹ️ User ${targetUser.email} is already deactivated`
      );
    }

    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [targetUser.id]);

    try {
      await pool.query(
        `INSERT INTO audit_logs (action, actor_id, target_id, description)
         VALUES ($1, $2, $3, $4)`,
        [
          'User Deactivated',
          actingUserId,
          targetUser.id,
          `User ${targetUser.name} (ID ${targetUser.id}) was deactivated via admin tools`
        ]
      );
    } catch (auditError) {
      console.warn('⚠️ Failed to record audit log for user deactivation:', auditError);
    }

    return successResponse(
      res,
      `✅ User ${targetUser.email} deactivated successfully`
    );
  } catch (err) {
    console.error('❌ Failed to deactivate user by email:', err);
    return errorResponse(res, 500, 'Failed to deactivate user');
  }
};

module.exports = {
  deactivateUserByEmail
};