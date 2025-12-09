//routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { authenticateUser } = require('../middleware/authMiddleware');
const {
  getPermissionsForUserId,
  applyDefaultRolePermissions,
} = require('../utils/permissionService');
const createHttpError = require('http-errors');
const checkColumnExists = require('../utils/checkColumnExists');
const { sendEmail } = require('../utils/emailService');

const normalizeEmail = (email = '') => email.trim().toLowerCase();
const ensureScmOrAdmin = (user) => {
  if (!user?.hasPermission || !user.hasPermission('users.manage')) {
    throw createHttpError(403, 'You do not have permission to perform this action');
  }
};

const getScmEmails = async (client = pool) => {
  const { rows } = await client.query(
    `SELECT email FROM users WHERE role = 'SCM' AND is_active = true`
  );

  return rows.map(row => row.email).filter(Boolean);
};

const ensureUsersUpdatedAtColumn = async () => {
  try {
    return await checkColumnExists({
      table: 'users',
      column: 'updated_at',
    });
  } catch (err) {
    console.error('❌ Failed to detect updated_at column on users table:', err);
    return false;
  }
};

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret'; // 🔐 Use a secure secret in production

// ============================
// 🔐 POST /auth/register (Protected - Admin or SCM only)
// ============================
router.post('/register', authenticateUser, async (req, res) => {
  const {
    name,
    email,
    password,
    role,
    department_id,
    section_id,
    employee_id,
  } = req.body;
  try {
    ensureScmOrAdmin(req.user);
  } catch (error) {
    return res.status(error.statusCode || error.status || 403).json({
      success: false,
      message: error.message,
    });
  }

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = normalizeEmail(email);
  const normalizedRole = typeof role === 'string' ? role.trim() : '';
  const employeeId = typeof employee_id === 'string' ? employee_id.trim() : '';
  const departmentId = parseInt(department_id, 10);
  const hasSectionId = section_id !== undefined && section_id !== null && section_id !== '';
  const sectionId = hasSectionId ? parseInt(section_id, 10) : null;

  if (!trimmedName || !normalizedEmail || !password || !normalizedRole || Number.isNaN(departmentId) || !employeeId) {
    return res.status(400).json({ success: false, message: 'Name, email, password, role, employee ID, and department are required' });
  }

  if (hasSectionId && Number.isNaN(sectionId)) {
    return res.status(400).json({ success: false, message: 'Section is invalid' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'User already exists' });
    }

    const employeeIdInUse = await client.query('SELECT id FROM users WHERE employee_id = $1', [employeeId]);
    if (employeeIdInUse.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'Employee ID is already assigned to another user' });
    }

    const pendingEmployeeId = await client.query(
      `SELECT id FROM user_registration_requests WHERE employee_id = $1 AND status = 'pending'`,
      [employeeId]
    );

    if (pendingEmployeeId.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'Employee ID has a pending registration request' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const sectionIdValue = sectionId === null ? null : sectionId;

    const newUser = await client.query(
      `INSERT INTO users (name, email, password, role, department_id, section_id, employee_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, email, role, department_id, section_id, employee_id`,
      [trimmedName, normalizedEmail, hashedPassword, normalizedRole, departmentId, sectionIdValue, employeeId]
    );

    const newUserId = newUser.rows[0]?.id;
    if (Number.isInteger(newUserId)) {
      await applyDefaultRolePermissions(newUserId, normalizedRole, {
        client,
        replaceExisting: true,
        skipIfExists: false,
      });
    }

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: '✅ User registered successfully',
      user: newUser.rows[0]
    });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('❌ Failed to rollback user registration transaction:', rollbackErr);
      }
    }
    console.error('❌ Registration error:', err);
    return res.status(500).json({ success: false, message: 'Server error during registration' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// ============================
// 🔑 POST /auth/login
// ============================
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }

  try {
    const normalizedEmail = normalizeEmail(email);
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }

    const token = jwt.sign(
      {
        user_id: user.id,
        role: user.role,
        department_id: user.department_id
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    const { permissions = [] } = await getPermissionsForUserId(user.id);

    return res.status(200).json({
      success: true,
      message: '✅ Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        department_id: user.department_id,
        section_id: user.section_id,
        permissions,
      }
    });
  } catch (err) {
    console.error('❌ Login error:', err);
    return res.status(500).json({ success: false, message: 'Server error during login' });
  }
});

// ============================
// 📝 POST /auth/register-request (Public)
// ============================
router.post('/register-request', async (req, res) => {
  const {
    name,
    email,
    password,
    department_id,
    section_id,
    requested_role,
    employee_id,
  } = req.body || {};

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = normalizeEmail(email);
  const employeeId = typeof employee_id === 'string' ? employee_id.trim() : '';

  if (!trimmedName || !normalizedEmail || !password || !department_id || !employeeId) {
    return res.status(400).json({
      success: false,
      message: 'Name, email, password, employee ID, and department are required',
    });
  }

  const role = (requested_role || 'requester').trim() || 'requester';
  const allowedSelfRegistrationRoles = new Set(['requester']);

  if (!allowedSelfRegistrationRoles.has(role)) {
    return res.status(400).json({
      success: false,
      message: 'Requested role is not eligible for self-registration',
    });
  }

  const departmentId = parseInt(department_id, 10);
  if (Number.isNaN(departmentId)) {
    return res.status(400).json({ success: false, message: 'Department is invalid' });
  }

  const sectionId = section_id !== undefined && section_id !== null && section_id !== ''
    ? parseInt(section_id, 10)
    : null;

  if (section_id && Number.isNaN(sectionId)) {
    return res.status(400).json({ success: false, message: 'Section is invalid' });
  }

  try {
    const userExists = await pool.query('SELECT 1 FROM users WHERE email = $1', [normalizedEmail]);
    if (userExists.rowCount > 0) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists' });
    }

    const employeeIdInUse = await pool.query('SELECT 1 FROM users WHERE employee_id = $1', [employeeId]);
    if (employeeIdInUse.rowCount > 0) {
      return res.status(409).json({ success: false, message: 'An account with this employee ID already exists' });
    }

    const pendingRequest = await pool.query(
      `SELECT status FROM user_registration_requests WHERE LOWER(email) = LOWER($1) AND status = 'pending'`,
      [normalizedEmail]
    );

    if (pendingRequest.rowCount > 0) {
      return res.status(409).json({ success: false, message: 'A pending request already exists for this email' });
    }

    const pendingEmployeeId = await pool.query(
      `SELECT status FROM user_registration_requests WHERE employee_id = $1 AND status = 'pending'`,
      [employeeId]
    );

    if (pendingEmployeeId.rowCount > 0) {
      return res.status(409).json({ success: false, message: 'A pending request already exists for this employee ID' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const { rows } = await pool.query(
      `INSERT INTO user_registration_requests
        (name, email, password_hash, requested_role, department_id, section_id, employee_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, email, requested_role AS role, department_id, section_id, employee_id, status, created_at`,
      [trimmedName, normalizedEmail, passwordHash, role, departmentId, sectionId, employeeId]
    );

    try {
      const scmEmails = await getScmEmails();
      if (scmEmails.length === 0) {
        console.warn('⚠️ No active SCM users found to notify about registration request');
      }

      const messageLines = [
        `${trimmedName} (${normalizedEmail}) submitted a new account registration request.`,
        `Requested role: ${role}.`,
        `Employee ID: ${employeeId}.`,
        `Department ID: ${departmentId}.`,
      ];

      if (sectionId) {
        messageLines.push(`Section ID: ${sectionId}.`);
      }

      await Promise.all(
        scmEmails.map(emailAddress => sendEmail(
          emailAddress,
          'New user registration request submitted',
          messageLines.join('\n')
        ))
      );
    } catch (notifyErr) {
      console.error('⚠️ Failed to notify SCM about registration request:', notifyErr);
    }

    return res.status(201).json({
      success: true,
      message: 'Account request submitted successfully',
      request: rows[0],
    });
  } catch (err) {
    console.error('❌ Register request error:', err);
    return res.status(500).json({ success: false, message: 'Server error while submitting request' });
  }
});

// ============================
// 📋 GET /auth/register-requests (Admin/SCM)
// ============================
router.get('/register-requests', authenticateUser, async (req, res) => {
  try {
    ensureScmOrAdmin(req.user);
  } catch (error) {
    return res.status(error.statusCode || error.status || 403).json({
      success: false,
      message: error.message,
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT r.id,
              r.name,
              r.email,
              r.requested_role AS role,
              r.department_id,
              d.name AS department_name,
              r.section_id,
              s.name AS section_name,
              r.employee_id,
              r.status,
              r.rejection_reason,
              r.reviewer_id,
              reviewer.name AS reviewer_name,
              r.reviewed_at,
              r.created_at
         FROM user_registration_requests r
    LEFT JOIN departments d ON d.id = r.department_id
    LEFT JOIN sections s ON s.id = r.section_id
    LEFT JOIN users reviewer ON reviewer.id = r.reviewer_id
        ORDER BY (r.status = 'pending') DESC, r.created_at ASC`
    );

    return res.json({ success: true, requests: rows });
  } catch (err) {
    console.error('❌ Fetch register requests error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load account requests' });
  }
});

// ============================
// ✅ POST /auth/register-requests/:id/approve (Admin/SCM)
// ============================
router.post('/register-requests/:id/approve', authenticateUser, async (req, res) => {
  const requestId = parseInt(req.params.id, 10);

  if (Number.isNaN(requestId)) {
    return res.status(400).json({ success: false, message: 'Invalid request id' });
  }

  try {
    ensureScmOrAdmin(req.user);
  } catch (error) {
    return res.status(error.statusCode || error.status || 403).json({
      success: false,
      message: error.message,
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const requestRes = await client.query(
      `SELECT id, name, email, password_hash, requested_role, department_id, section_id, employee_id, status
         FROM user_registration_requests
        WHERE id = $1
        FOR UPDATE`,
      [requestId]
    );

    if (requestRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Account request not found' });
    }

    const request = requestRes.rows[0];

    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'Account request has already been processed' });
    }

    const normalizedEmail = normalizeEmail(request.email);
    const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);

    if (existingUser.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'A user with this email already exists' });
    }

    const employeeId = typeof request.employee_id === 'string' ? request.employee_id.trim() : '';
    if (!employeeId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Account request is missing an employee ID' });
    }

    const employeeIdInUse = await client.query('SELECT id FROM users WHERE employee_id = $1', [employeeId]);
    if (employeeIdInUse.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'Employee ID is already assigned to another user' });
    }

    const newUser = await client.query(
      `INSERT INTO users (name, email, password, role, department_id, section_id, employee_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, email, role, department_id, section_id, employee_id`,
      [
        request.name,
        normalizedEmail,
        request.password_hash,
        request.requested_role,
        request.department_id,
        request.section_id,
        employeeId,
      ]
    );

    const createdUserId = newUser.rows[0]?.id;
    if (Number.isInteger(createdUserId)) {
      await applyDefaultRolePermissions(createdUserId, request.requested_role, {
        client,
        replaceExisting: true,
        skipIfExists: false,
      });
    }

    await client.query(
      `UPDATE user_registration_requests
          SET status = 'approved',
              reviewer_id = $2,
              reviewed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [requestId, req.user.id]
    );

    await client.query('COMMIT');

    try {
      await sendEmail(
        normalizedEmail,
        'Your account registration has been approved',
        [
          `Hi ${request.name},`,
          '',
          'Great news! Your account request has been approved and your profile is now active in the system.',
          'You can log in using the email address you registered with.',
          '',
          'If you run into any issues signing in, please reach out to the SCM team for assistance.',
        ].join('\n')
      );
    } catch (emailErr) {
      console.error('⚠️ Failed to send account approval email:', emailErr);
    }

    return res.json({
      success: true,
      message: 'Account request approved and user created',
      user: newUser.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Approve register request error:', err);
    return res.status(500).json({ success: false, message: 'Failed to approve account request' });
  } finally {
    client.release();
  }
});

// ============================
// ❌ POST /auth/register-requests/:id/reject (Admin/SCM)
// ============================
router.post('/register-requests/:id/reject', authenticateUser, async (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  const { reason } = req.body || {};

  if (Number.isNaN(requestId)) {
    return res.status(400).json({ success: false, message: 'Invalid request id' });
  }

  try {
    ensureScmOrAdmin(req.user);
  } catch (error) {
    return res.status(error.statusCode || error.status || 403).json({
      success: false,
      message: error.message,
    });
  }

  try {
    const { rowCount } = await pool.query(
      `UPDATE user_registration_requests
          SET status = 'rejected',
              rejection_reason = $2,
              reviewer_id = $3,
              reviewed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1 AND status = 'pending'`,
      [requestId, reason ? reason.trim() : null, req.user.id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Pending account request not found' });
    }

    return res.json({ success: true, message: 'Account request rejected' });
  } catch (err) {
    console.error('❌ Reject register request error:', err);
    return res.status(500).json({ success: false, message: 'Failed to reject account request' });
  }
});

// ============================
// 📋 GET /auth/register-request/departments (Public)
// ============================
router.get('/register-request/departments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.id,
              d.name,
              COALESCE(
                JSON_AGG(
                  JSON_BUILD_OBJECT('id', s.id, 'name', s.name)
                  ORDER BY s.name
                ) FILTER (WHERE s.id IS NOT NULL),
                '[]'::JSON
              ) AS sections
         FROM departments d
    LEFT JOIN sections s ON s.department_id = d.id
        GROUP BY d.id
        ORDER BY d.name`
    );

    return res.json({ success: true, departments: rows });
  } catch (err) {
    console.error('❌ Public departments fetch error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load departments' });
  }
});

// ============================
// 🔒 PUT /auth/change-password
// ============================
router.put('/change-password', authenticateUser, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res
      .status(400)
      .json({ success: false, message: 'Current password and new password are required' });
  }

  if (newPassword.length < 8) {
    return res
      .status(400)
      .json({ success: false, message: 'New password must be at least 8 characters long' });
  }

  try {
    const userResult = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);

    if (userResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = userResult.rows[0];

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res
        .status(400)
        .json({ success: false, message: 'New password must be different from the current password' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    const hasUpdatedAtColumn = await ensureUsersUpdatedAtColumn();
    const updateQuery = hasUpdatedAtColumn
      ? 'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2'
      : 'UPDATE users SET password = $1 WHERE id = $2';

    if (!hasUpdatedAtColumn) {
      console.warn('⚠️ users.updated_at column missing; skipping timestamp update for password change');
    }

    await pool.query(updateQuery, [hashedPassword, req.user.id]);

    return res.status(200).json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('❌ Password change error:', err);
    return res.status(500).json({ success: false, message: 'Server error while changing password' });
  }
});

// ============================
// 👤 GET /auth/me (Authenticated User Info)
// ============================
router.get('/me', authenticateUser, (req, res) => {
  return res.status(200).json({
    success: true,
    user: req.user
  });
});

module.exports = router;
