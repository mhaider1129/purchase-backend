//routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { authenticateUser } = require('../middleware/authMiddleware');

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret'; // 🔐 Use a secure secret in production

// ============================
// 🔐 POST /auth/register (Protected - Admin or SCM only)
// ============================
router.post('/register', authenticateUser, async (req, res) => {
  const { name, email, password, role, department_id , section_id } = req.body;

  if (!['admin', 'SCM'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Only admin or SCM can register users' });
  }

  if (!name || !email || !password || !role || !department_id) {
    return res.status(400).json({ success: false, message: 'All fields except section are required' });
  }

  try {
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const sectionIdValue = section_id || null;

    const newUser = await pool.query(
      `INSERT INTO users (name, email, password, role, department_id, section_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, role, department_id, section_id`,
      [name, email, hashedPassword, role, department_id, sectionIdValue]
    );

    return res.status(201).json({
      success: true,
      message: '✅ User registered successfully',
      user: newUser.rows[0]
    });
  } catch (err) {
    console.error('❌ Registration error:', err);
    return res.status(500).json({ success: false, message: 'Server error during registration' });
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
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
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

    return res.status(200).json({
      success: true,
      message: '✅ Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        department_id: user.department_id,
        section_id: user.section_id
      }
    });
  } catch (err) {
    console.error('❌ Login error:', err);
    return res.status(500).json({ success: false, message: 'Server error during login' });
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
