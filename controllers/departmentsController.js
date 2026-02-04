const pool = require('../config/db');

const getDepartmentsWithSections = async (req, res) => {
  try {
    const params = [];
    let whereClause = '';
    if (Number.isInteger(req.user?.institute_id)) {
      params.push(req.user.institute_id);
      whereClause = 'WHERE institute_id = $1';
    }

    const depRes = await pool.query(`SELECT * FROM departments ${whereClause}`, params);
    const departmentIds = depRes.rows.map(dep => dep.id);
    const secRes = departmentIds.length
      ? await pool.query(
        'SELECT * FROM sections WHERE department_id = ANY($1::INT[])',
        [departmentIds]
      )
      : { rows: [] };

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

const ALLOWED_DEPARTMENT_TYPES = ['Medical', 'Operational'];

const normalizeDepartmentType = rawType => {
  if (typeof rawType !== 'string') {
    return null;
  }

  const cleaned = rawType.trim().toLowerCase();
  if (!cleaned) {
    return null;
  }

  if (cleaned === 'medical') {
    return 'Medical';
  }

  if (cleaned === 'operational') {
    return 'Operational';
  }

  return null;
};

const createDepartment = async (req, res) => {
  if (!req.user.hasPermission('departments.manage')) {
    return res.status(403).json({ message: 'You do not have permission to manage departments' });
  }

  const { name, type } = req.body;
  const normalizedType = normalizeDepartmentType(type);

  if (!name || !normalizedType) {
    return res.status(400).json({
      message:
        'Name and type are required. Allowed types are Medical and Operational. Warehouses must be created using the dedicated warehouse management screen.',
    });
  }

  try {
    if (!Number.isInteger(req.user?.institute_id)) {
      return res.status(400).json({ message: 'User is not linked to an institute' });
    }

    const { rows } = await pool.query(
      'INSERT INTO departments (name, type, institute_id) VALUES ($1, $2, $3) RETURNING *',
      [name, normalizedType, req.user.institute_id]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to create department:', err);
    res.status(500).json({ message: 'Failed to create department' });
  }
};

const createSection = async (req, res) => {
  if (!req.user.hasPermission('departments.manage')) {
    return res.status(403).json({ message: 'You do not have permission to manage departments' });
  }
  const departmentId = req.params.id;
  const { name } = req.body;
  if (!departmentId || !name) {
    return res.status(400).json({ message: 'Department and name are required' });
  }
  try {
    if (Number.isInteger(req.user?.institute_id)) {
      const { rows } = await pool.query(
        'SELECT institute_id FROM departments WHERE id = $1',
        [departmentId]
      );
      const instituteId = rows[0]?.institute_id;
      if (!Number.isInteger(instituteId)) {
        return res.status(404).json({ message: 'Department not found' });
      }
      if (instituteId !== req.user.institute_id) {
        return res.status(403).json({ message: 'Department is outside your institute' });
      }
    }

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