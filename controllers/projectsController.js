const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

const normalizeName = (name = '') => name.trim();

const getProjects = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, is_active, created_at
         FROM projects
        WHERE is_active IS DISTINCT FROM FALSE
        ORDER BY LOWER(name)`
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to fetch projects:', err);
    next(createHttpError(500, 'Failed to fetch projects'));
  }
};

const createProject = async (req, res, next) => {
  const rawName = req.body?.name;
  const name = normalizeName(rawName);

  if (!name) {
    return next(createHttpError(400, 'Project name is required'));
  }

  const role = (req.user?.role || '').toUpperCase();
  if (!['SCM', 'ADMIN'].includes(role)) {
    return next(createHttpError(403, 'Only SCM or Admin can create projects'));
  }

  try {
    const existing = await pool.query(
      `SELECT id FROM projects WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [name]
    );

    if (existing.rowCount > 0) {
      return next(createHttpError(409, 'Project name already exists'));
    }

    const { rows } = await pool.query(
      `INSERT INTO projects (name, created_by)
       VALUES ($1, $2)
       RETURNING id, name, is_active, created_at`,
      [name, req.user?.id || null]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to create project:', err);
    next(createHttpError(500, 'Failed to create project'));
  }
};

module.exports = {
  getProjects,
  createProject,
};