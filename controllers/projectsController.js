const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const ensureProjectsTable = require('../utils/ensureProjectsTable');

const normalizeName = (name = '') => name.trim();

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeProjectId = (value) => {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return uuidPattern.test(candidate) ? candidate : null;
};

const canManageProjects = (req) =>
  Boolean(req.user?.hasPermission && req.user.hasPermission('projects.manage'));

const normalizeDepartmentIds = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  );
};

const visibleDepartmentSelect = `
  COALESCE(
    JSON_AGG(
      JSON_BUILD_OBJECT('id', d.id, 'name', d.name, 'type', d.type)
      ORDER BY LOWER(d.name)
    ) FILTER (WHERE d.id IS NOT NULL),
    '[]'::json
  ) AS visible_departments`;

const projectSelect = `
  SELECT p.id, p.name, p.is_active, p.created_at, ${visibleDepartmentSelect}
    FROM projects p
    LEFT JOIN project_department_visibility pdv ON pdv.project_id = p.id
    LEFT JOIN departments d ON d.id = pdv.department_id`;

const applyProjectDepartmentVisibility = async (client, projectId, departmentIds, user) => {
  await client.query('DELETE FROM project_department_visibility WHERE project_id = $1', [projectId]);

  if (departmentIds.length === 0) {
    return;
  }

  const params = [departmentIds];
  let instituteClause = '';
  if (Number.isInteger(user?.institute_id)) {
    params.push(user.institute_id);
    instituteClause = ` AND institute_id = $${params.length}`;
  }

  const { rows } = await client.query(
    `SELECT id
       FROM departments
      WHERE id = ANY($1::INT[])${instituteClause}`,
    params
  );
  const validDepartmentIds = new Set(rows.map((row) => row.id));
  const invalidIds = departmentIds.filter((id) => !validDepartmentIds.has(id));

  if (invalidIds.length > 0) {
    throw createHttpError(400, 'One or more selected departments do not exist');
  }

  await client.query(
    `INSERT INTO project_department_visibility (project_id, department_id)
     SELECT $1::UUID, UNNEST($2::INT[])
     ON CONFLICT DO NOTHING`,
    [projectId, departmentIds]
  );
};

const getProjects = async (req, res, next) => {
  try {
    await ensureProjectsTable();
    const params = [];
    let visibilityClause = 'TRUE';

    if (!canManageProjects(req)) {
      visibilityClause = `NOT EXISTS (
        SELECT 1 FROM project_department_visibility scope WHERE scope.project_id = p.id
      )`;

      if (Number.isInteger(req.user?.department_id)) {
        params.push(req.user.department_id);
        visibilityClause = `(${visibilityClause} OR EXISTS (
          SELECT 1
            FROM project_department_visibility scope
           WHERE scope.project_id = p.id
             AND scope.department_id = $${params.length}
        ))`;
      }
    }

    const { rows } = await pool.query(
      `${projectSelect}
        WHERE p.is_active IS DISTINCT FROM FALSE
          AND ${visibilityClause}
        GROUP BY p.id, p.name, p.is_active, p.created_at
        ORDER BY LOWER(p.name)`,
      params
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
  const departmentIds = normalizeDepartmentIds(req.body?.department_ids);

  if (!name) {
    return next(createHttpError(400, 'Project name is required'));
  }

  if (!canManageProjects(req)) {
    return next(createHttpError(403, 'Only SCM or Admin can create projects'));
  }

  let client;

  try {
    client = await pool.connect();
    await ensureProjectsTable();
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id FROM projects WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [name]
    );

    if (existing.rowCount > 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(409, 'Project name already exists'));
    }

    const insert = await client.query(
      `INSERT INTO projects (name, created_by)
       VALUES ($1, $2)
       RETURNING id, name, is_active, created_at`,
      [name, req.user?.id || null]
    );

    await applyProjectDepartmentVisibility(client, insert.rows[0].id, departmentIds, req.user);

    const { rows } = await client.query(
      `${projectSelect}
        WHERE p.id = $1
        GROUP BY p.id, p.name, p.is_active, p.created_at`,
      [insert.rows[0].id]
    );

    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('❌ Failed to create project:', err);
    if (err?.statusCode) {
      return next(err);
    }
    next(createHttpError(500, 'Failed to create project'));
  } finally {
    if (client) {
      client.release();
    }
  }
};

const getAllProjects = async (req, res, next) => {
  if (!canManageProjects(req)) {
    return next(createHttpError(403, 'Only SCM or Admin can view all projects'));
  }

  try {
    await ensureProjectsTable();
    const { rows } = await pool.query(
      `${projectSelect}
        GROUP BY p.id, p.name, p.is_active, p.created_at
        ORDER BY LOWER(p.name)`
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to fetch all projects:', err);
    next(createHttpError(500, 'Failed to fetch projects'));
  }
};

const updateProjectDepartments = async (req, res, next) => {
  if (!canManageProjects(req)) {
    return next(createHttpError(403, 'Only SCM or Admin can update project visibility'));
  }

  const projectId = normalizeProjectId(req.params.id);

  if (!projectId) {
    return next(createHttpError(400, 'Invalid project ID'));
  }

  const departmentIds = normalizeDepartmentIds(req.body?.department_ids);
  let client;

  try {
    client = await pool.connect();
    await ensureProjectsTable();
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id FROM projects WHERE id = $1 LIMIT 1`,
      [projectId]
    );

    if (existing.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Project not found'));
    }

    await applyProjectDepartmentVisibility(client, projectId, departmentIds, req.user);

    const { rows } = await client.query(
      `${projectSelect}
        WHERE p.id = $1
        GROUP BY p.id, p.name, p.is_active, p.created_at`,
      [projectId]
    );

    await client.query('COMMIT');
    res.json({
      message: `✅ Project visibility updated successfully`,
      project: rows[0],
    });
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('❌ Failed to update project visibility:', err);
    if (err?.statusCode) {
      return next(err);
    }
    next(createHttpError(500, 'Failed to update project visibility'));
  } finally {
    if (client) {
      client.release();
    }
  }
};

const deactivateProject = async (req, res, next) => {
  if (!canManageProjects(req)) {
    return next(createHttpError(403, 'Only SCM or Admin can deactivate projects'));
  }

  const projectId = normalizeProjectId(req.params.id);

  if (!projectId) {
    return next(createHttpError(400, 'Invalid project ID'));
  }

  try {
    await ensureProjectsTable();
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
  updateProjectDepartments,
  deactivateProject,
};