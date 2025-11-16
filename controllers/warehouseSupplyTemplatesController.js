const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

let departmentColumnChecked = false;
let departmentColumnAvailable = false;

const ensureDepartmentIdColumn = async () => {
  if (departmentColumnChecked) {
    return departmentColumnAvailable;
  }

  try {
    const columnResult = await pool.query(
      `SELECT 1
         FROM information_schema.columns
        WHERE table_name = 'warehouse_supply_templates'
          AND column_name = 'department_id'
        LIMIT 1`
    );

    if (columnResult.rowCount === 0) {
      await pool.query(
        `ALTER TABLE warehouse_supply_templates
           ADD COLUMN IF NOT EXISTS department_id INT REFERENCES departments(id)`
      );
    }

    departmentColumnAvailable = true;
    departmentColumnChecked = true;
    return true;
  } catch (err) {
    console.error('❌ Failed to ensure department_id column on warehouse_supply_templates:', err);
    departmentColumnChecked = true;
    departmentColumnAvailable = false;
    throw createHttpError(500, 'Failed to prepare warehouse supply templates table');
  }
};

const normalizeItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw createHttpError(400, 'items must be a non-empty array');
  }

  const cleanedItems = items.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw createHttpError(400, `Item ${index + 1} must be an object with item_name`);
    }

    const name = typeof item.item_name === 'string' ? item.item_name.trim() : '';
    if (!name) {
      throw createHttpError(400, `Item ${index + 1} must include a non-empty item_name`);
    }

    if (name.length > 255) {
      throw createHttpError(400, `Item ${index + 1} name is too long (max 255 characters)`);
    }

    return { item_name: name };
  });

  const seen = new Set();
  for (const item of cleanedItems) {
    const key = item.item_name.toLowerCase();
    if (seen.has(key)) {
      throw createHttpError(400, 'Items must be unique within a template');
    }
    seen.add(key);
  }

  return cleanedItems;
};

const parseItems = (itemsValue) => {
  if (!itemsValue) return [];
  if (Array.isArray(itemsValue)) return itemsValue;
  try {
    const parsed = JSON.parse(itemsValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('⚠️ Failed to parse template items JSON, defaulting to empty array');
    return [];
  }
};

const ensureTemplatePermission = (req, action = 'manage') => {
  const permission = action === 'view' ? 'warehouse.view-supply' : 'warehouse.manage-supply';
  if (!req.user?.hasPermission(permission)) {
    throw createHttpError(403, 'You do not have permission to manage warehouse templates');
  }
};

const requireDepartmentContext = (req) => {
  if (!req.user?.department_id) {
    throw createHttpError(400, 'A department is required to manage templates');
  }
  return req.user.department_id;
};

// Fetch all templates
const getTemplates = async (req, res, next) => {
  try {
    ensureTemplatePermission(req, 'view');
    const departmentId = requireDepartmentContext(req);
    await ensureDepartmentIdColumn();

    const result = await pool.query(
      `SELECT id, template_name, items
         FROM warehouse_supply_templates
        WHERE department_id = $1
        ORDER BY template_name`,
      [departmentId]
    );

    const templates = result.rows.map((row) => ({
      ...row,
      items: parseItems(row.items),
    }));

    res.json(templates);
  } catch (err) {
    console.error('❌ Failed to fetch warehouse supply templates:', err);
    next(err.statusCode ? err : createHttpError(500, 'Failed to fetch templates'));
  }
};

// Create a new template
const createTemplate = async (req, res, next) => {
  try {
    ensureTemplatePermission(req);
    const departmentId = requireDepartmentContext(req);
    await ensureDepartmentIdColumn();

    const { template_name, items } = req.body;
    if (!template_name || typeof template_name !== 'string' || !template_name.trim()) {
      return next(createHttpError(400, 'template_name is required'));
    }

    const sanitizedItems = normalizeItems(items);

    const { rows } = await pool.query(
      `INSERT INTO warehouse_supply_templates (template_name, items, department_id)
       VALUES ($1,$2,$3) RETURNING id, template_name, items, department_id`,
      [template_name.trim(), JSON.stringify(sanitizedItems), departmentId]
    );

    const created = rows[0];
    res.status(201).json({ ...created, items: sanitizedItems });
  } catch (err) {
    console.error('❌ Failed to create warehouse supply template:', err);
    next(err.statusCode ? err : createHttpError(500, 'Failed to create template'));
  }
};

// Update an existing template
const updateTemplate = async (req, res, next) => {
  try {
    ensureTemplatePermission(req);
    const departmentId = requireDepartmentContext(req);
    await ensureDepartmentIdColumn();

    const { id } = req.params;
    const { template_name, items } = req.body;

    if (!template_name || typeof template_name !== 'string' || !template_name.trim()) {
      return next(createHttpError(400, 'template_name is required'));
    }

    const sanitizedItems = normalizeItems(items);

    const { rows } = await pool.query(
      `UPDATE warehouse_supply_templates
         SET template_name = $1,
             items = $2
       WHERE id = $3 AND department_id = $4
       RETURNING id, template_name, items, department_id`,
      [template_name.trim(), JSON.stringify(sanitizedItems), id, departmentId]
    );

    if (rows.length === 0) return next(createHttpError(404, 'Template not found'));
    res.json({ ...rows[0], items: sanitizedItems });
  } catch (err) {
    console.error('❌ Failed to update warehouse supply template:', err);
    next(err.statusCode ? err : createHttpError(500, 'Failed to update template'));
  }
};

// Delete a template
const deleteTemplate = async (req, res, next) => {
  try {
    ensureTemplatePermission(req);
    const departmentId = requireDepartmentContext(req);
    await ensureDepartmentIdColumn();

    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM warehouse_supply_templates WHERE id = $1 AND department_id = $2 RETURNING id',
      [id, departmentId]
    );
    if (result.rowCount === 0) return next(createHttpError(404, 'Template not found'));
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Failed to delete warehouse supply template:', err);
    next(err.statusCode ? err : createHttpError(500, 'Failed to delete template'));
  }
};

module.exports = { getTemplates, createTemplate, updateTemplate, deleteTemplate };