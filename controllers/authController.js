//controller/authController.js
const pool = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const createHttpError = require('../utils/httpError');

// 🔐 Login Handler
const login = async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(createHttpError(400, 'Email and password are required'));
  }

  try {
    // 1. Fetch active user by email
    const { rows } = await pool.query(
      `SELECT id, name, email, password, role, department_id, section_id FROM users WHERE email = $1 AND is_active = TRUE`,
      [email]
    );

    const user = rows[0];
    if (!user) {
      return next(createHttpError(401, 'Invalid email or password'));
    }

    // 2. Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return next(createHttpError(401, 'Invalid email or password'));
    }

    // 3. Generate JWT token
    const token = jwt.sign(
      {
        user_id: user.id,
        role: user.role,
        department_id: user.department_id,
        section_id: user.section_id || null // Optional field
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    // 4. Send structured response
    res.json({
      message: '✅ Login successful',
      token,
      expires_in: '8h',
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        department_id: user.department_id,
        section_id: user.section_id || null // Optional field
      }
    });

  } catch (err) {
    console.error('❌ Login Error:', err);
    next(createHttpError(500, 'Login failed. Please try again.'));
  }
};

module.exports = { login };
