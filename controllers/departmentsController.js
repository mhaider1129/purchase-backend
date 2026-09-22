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

const updateDepartment = async (req, res) => {
  if (!req.user.hasPermission('departments.manage')) {
    return res.status(403).json({ message: 'You do not have permission to manage departments' });
  }

  const departmentId = Number.parseInt(req.params.id, 10);
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const normalizedType = normalizeDepartmentType(req.body?.type);
  if (!Number.isInteger(departmentId) || !name || !normalizedType) {
    return res.status(400).json({ message: 'A valid department, name, and type are required' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE departments
          SET name = $1, type = $2
        WHERE id = $3 AND institute_id = $4
        RETURNING *`,
      [name, normalizedType, departmentId, req.user.institute_id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Department not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to update department:', err);
    return res.status(500).json({ message: 'Failed to update department' });
  }
};

const updateSection = async (req, res) => {
  if (!req.user.hasPermission('departments.manage')) {
    return res.status(403).json({ message: 'You do not have permission to manage departments' });
  }

  const departmentId = Number.parseInt(req.params.id, 10);
  const sectionId = Number.parseInt(req.params.sectionId, 10);
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!Number.isInteger(departmentId) || !Number.isInteger(sectionId) || !name) {
    return res.status(400).json({ message: 'A valid department, section, and name are required' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE sections s
          SET name = $1
         FROM departments d
        WHERE s.id = $2 AND s.department_id = $3
          AND d.id = s.department_id AND d.institute_id = $4
        RETURNING s.*`,
      [name, sectionId, departmentId, req.user.institute_id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Section not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to update section:', err);
    return res.status(500).json({ message: 'Failed to update section' });
  }
};

module.exports = {
  getDepartmentsWithSections,
  createDepartment,
  createSection,
  updateDepartment,
  updateSection,
};