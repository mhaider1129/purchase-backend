const pool = require('../config/db');

const getRoles = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name FROM roles ORDER BY name');
    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to load roles:', err);
    res.status(500).json({ message: 'Failed to load roles' });
  }
};

const createRole = async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ message: 'Role name is required' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO roles (name) VALUES ($1) RETURNING id, name',
      [name]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to create role:', err);
    res.status(500).json({ message: 'Failed to create role' });
  }
};

module.exports = { getRoles, createRole };