const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

// Fetch all templates
const getTemplates = async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, template_name, items FROM warehouse_supply_templates ORDER BY template_name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to fetch warehouse supply templates:', err);
    next(createHttpError(500, 'Failed to fetch templates'));
  }
};

// Create a new template
const createTemplate = async (req, res, next) => {
  const { template_name, items } = req.body;
  if (!template_name || !Array.isArray(items) || items.length === 0) {
    return next(createHttpError(400, 'template_name and items are required'));
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO warehouse_supply_templates (template_name, items)
       VALUES ($1,$2) RETURNING id, template_name, items`,
      [template_name, JSON.stringify(items)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to create warehouse supply template:', err);
    next(createHttpError(500, 'Failed to create template'));
  }
};

// Update an existing template
const updateTemplate = async (req, res, next) => {
  const { id } = req.params;
  const { template_name, items } = req.body;
  if (!template_name || !Array.isArray(items) || items.length === 0) {
    return next(createHttpError(400, 'template_name and items are required'));
  }
  try {
    const { rows } = await pool.query(
      `UPDATE warehouse_supply_templates
         SET template_name = $1,
             items = $2
       WHERE id = $3
       RETURNING id, template_name, items`,
      [template_name, JSON.stringify(items), id]
    );
    if (rows.length === 0) return next(createHttpError(404, 'Template not found'));
    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to update warehouse supply template:', err);
    next(createHttpError(500, 'Failed to update template'));
  }
};

// Delete a template
const deleteTemplate = async (req, res, next) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM warehouse_supply_templates WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rowCount === 0) return next(createHttpError(404, 'Template not found'));
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Failed to delete warehouse supply template:', err);
    next(createHttpError(500, 'Failed to delete template'));
  }
};

module.exports = { getTemplates, createTemplate, updateTemplate, deleteTemplate };