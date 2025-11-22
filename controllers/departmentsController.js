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

const ALLOWED_DEPARTMENT_TYPES = ['medical', 'operational'];

const normalizeDepartmentType = rawType => {
  if (typeof rawType !== 'string') {
    return null;
  }

  const cleaned = rawType.trim().toLowerCase();
  if (!cleaned) {
    return null;
  }

  if (cleaned === 'warehouse') {
    // Warehouses are tracked as operational departments and assigned to warehouse managers
    return { normalized: 'operational', isWarehouseAlias: true };
  }

  if (ALLOWED_DEPARTMENT_TYPES.includes(cleaned)) {
    return { normalized: cleaned, isWarehouseAlias: false };
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
        'Name and type are required. Allowed types are medical and operational; warehouses should be created as operational departments.',
    });
  }

  try {
    const { rows } = await pool.query(
      'INSERT INTO departments (name, type) VALUES ($1, $2) RETURNING *',
      [name, normalizedType.normalized]
    );

    const createdDepartment = rows[0];
    if (normalizedType.isWarehouseAlias) {
      createdDepartment.type = 'operational';
      createdDepartment.notes =
        'Warehouse names are stored as operational departments and can be assigned to warehouse managers.';
    }

    res.status(201).json(createdDepartment);
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