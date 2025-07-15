const pool = require('../config/db');

const getDepartmentsWithSections = async (req, res) => {
  try {
    const depRes = await pool.query('SELECT * FROM departments');
    const secRes = await pool.query('SELECT * FROM sections');

    const departments = depRes.rows.map(dep => ({
      ...dep,
      sections: secRes.rows.filter(s => s.department_id === dep.id),
    }));

    res.json(departments);
  } catch (err) {
    console.error('❌ Failed to load departments with sections:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const createDepartment = async (req, res) => {
  const { role } = req.user;
  if (!['admin', 'SCM'].includes(role)) {
    return res.status(403).json({ message: 'Unauthorized' });
  }
  const { name, type } = req.body;
  if (!name || !type) {
    return res.status(400).json({ message: 'Name and type are required' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO departments (name, type) VALUES ($1, $2) RETURNING *',
      [name, type]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to create department:', err);
    res.status(500).json({ message: 'Failed to create department' });
  }
};

const createSection = async (req, res) => {
  const { role } = req.user;
  if (!['admin', 'SCM'].includes(role)) {
    return res.status(403).json({ message: 'Unauthorized' });
  }
  const departmentId = req.params.id;
  const { name } = req.body;
  if (!departmentId || !name) {
    return res.status(400).json({ message: 'Department and name are required' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO sections (name, department_id) VALUES ($1, $2) RETURNING *',
      [name, departmentId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to create section:', err);
    res.status(500).json({ message: 'Failed to create section' });
  }
};

module.exports = { getDepartmentsWithSections, createDepartment, createSection };