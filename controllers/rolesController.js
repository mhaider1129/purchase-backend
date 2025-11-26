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
      [name.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Role name already exists' });
    }
    console.error('❌ Failed to create role:', err);
    res.status(500).json({ message: 'Failed to create role' });
  }
};

const updateRole = async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ message: 'Role name is required' });
  }

  try {
    const { rows } = await pool.query(
      'UPDATE roles SET name = $1 WHERE id = $2 RETURNING id, name',
      [name.trim(), id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Role not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Role name already exists' });
    }
    console.error('❌ Failed to update role:', err);
    res.status(500).json({ message: 'Failed to update role' });
  }
};

const deleteRole = async (req, res) => {
  const { id } = req.params;

  try {
    const { rowCount } = await pool.query('DELETE FROM roles WHERE id = $1', [id]);

    if (!rowCount) {
      return res.status(404).json({ message: 'Role not found' });
    }

    res.status(204).send();
  } catch (err) {
    console.error('❌ Failed to delete role:', err);
    res.status(500).json({ message: 'Failed to delete role' });
  }
};

module.exports = { getRoles, createRole, updateRole, deleteRole };