const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

const normalizeName = (name = '') => name.trim();

const canManageProjects = (req) => {
  const role = (req.user?.role || '').toUpperCase();
  return role === 'SCM' || role === 'ADMIN';
};

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

  if (!canManageProjects(req)) {
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

const getAllProjects = async (req, res, next) => {
  if (!canManageProjects(req)) {
    return next(createHttpError(403, 'Only SCM or Admin can view all projects'));
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, name, is_active, created_at
         FROM projects
        ORDER BY LOWER(name)`
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to fetch all projects:', err);
    next(createHttpError(500, 'Failed to fetch projects'));
  }
};

const deactivateProject = async (req, res, next) => {
  if (!canManageProjects(req)) {
    return next(createHttpError(403, 'Only SCM or Admin can deactivate projects'));
  }

  const projectId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(projectId)) {
    return next(createHttpError(400, 'Invalid project ID'));
  }

  try {
    const existing = await pool.query(
      `SELECT id, name, is_active, created_at
         FROM projects
        WHERE id = $1
        LIMIT 1`,
      [projectId]
    );

    if (existing.rowCount === 0) {
      return next(createHttpError(404, 'Project not found'));
    }

    const project = existing.rows[0];

    if (project.is_active === false) {
      return res.json({
        message: `ℹ️ Project "${project.name}" is already deactivated`,
        project,
      });
    }

    const update = await pool.query(
      `UPDATE projects
          SET is_active = FALSE
        WHERE id = $1
        RETURNING id, name, is_active, created_at`,
      [projectId]
    );

    res.json({
      message: `✅ Project "${update.rows[0].name}" deactivated successfully`,
      project: update.rows[0],
    });
  } catch (err) {
    console.error('❌ Failed to deactivate project:', err);
    next(createHttpError(500, 'Failed to deactivate project'));
  }
};

module.exports = {
  getProjects,
  createProject,
  getAllProjects,
  deactivateProject,
};