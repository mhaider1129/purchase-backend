const express = require('express');
const pool = require('../config/db');

const router = express.Router();

const TASK_STATUSES = new Set(['pending', 'in_progress', 'completed', 'blocked']);
const ASSIGNER_ROLES = new Set(['SCM', 'COO']);

let ensureTasksTablePromise;

const ensureTasksTable = async () => {
  if (!ensureTasksTablePromise) {
    ensureTasksTablePromise = pool.query(`
      CREATE TABLE IF NOT EXISTS employee_tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        assigned_to INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        assigned_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'pending',
        employee_update TEXT,
        assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_employee_tasks_assigned_to ON employee_tasks (assigned_to);
      CREATE INDEX IF NOT EXISTS idx_employee_tasks_assigned_by ON employee_tasks (assigned_by);
    `);
  }

  return ensureTasksTablePromise;
};

const canAssignTasks = (user) => ASSIGNER_ROLES.has(user?.role);

router.post('/', async (req, res) => {
  if (!canAssignTasks(req.user)) {
    return res.status(403).json({ success: false, message: 'Only Supply Chain Manager (SCM) or COO can assign tasks.' });
  }

  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : null;
  const assignedTo = Number(req.body?.assigned_to);

  if (!title || Number.isNaN(assignedTo)) {
    return res.status(400).json({ success: false, message: 'title and assigned_to are required.' });
  }

  try {
    await ensureTasksTable();
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1 AND is_active = TRUE', [assignedTo]);
    if (!userCheck.rowCount) {
      return res.status(404).json({ success: false, message: 'Assigned employee not found or inactive.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO employee_tasks (title, description, assigned_to, assigned_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [title, description, assignedTo, req.user.id]
    );

    return res.status(201).json({ success: true, task: rows[0] });
  } catch (err) {
    console.error('❌ create task error:', err);
    return res.status(500).json({ success: false, message: 'Failed to assign task.' });
  }
});


router.get('/assignable-users', async (req, res) => {
  if (!canAssignTasks(req.user)) {
    return res.status(403).json({ success: false, message: 'Only Supply Chain Manager (SCM) or COO can view assignable users.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, name, role
       FROM users
       WHERE is_active = TRUE
         AND role NOT IN ('SCM', 'COO', 'admin')
       ORDER BY name ASC`
    );

    return res.json({ success: true, users: rows });
  } catch (err) {
    console.error('❌ load assignable users error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load assignable users.' });
  }
});

router.get('/assigned-by-me', async (req, res) => {
  if (!canAssignTasks(req.user)) {
    return res.status(403).json({ success: false, message: 'Only Supply Chain Manager (SCM) or COO can view this list.' });
  }

  const statusFilter = typeof req.query?.status === 'string' ? req.query.status.trim().toLowerCase() : '';

  try {
    await ensureTasksTable();

    const params = [req.user.id];
    let whereClause = 'WHERE t.assigned_by = $1';

    if (statusFilter && TASK_STATUSES.has(statusFilter)) {
      params.push(statusFilter);
      whereClause += ` AND t.status = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.description, t.status, t.employee_update, t.assigned_at, t.updated_at, t.completed_at,
              assignee.name AS assigned_to_name, assignee.id AS assigned_to
       FROM employee_tasks t
       JOIN users assignee ON assignee.id = t.assigned_to
       ${whereClause}
       ORDER BY t.updated_at DESC, t.assigned_at DESC`,
      params
    );

    return res.json({ success: true, tasks: rows });
  } catch (err) {
    console.error('❌ list assigned-by-me tasks error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load assigned tasks.' });
  }
});

router.patch('/:id/manage', async (req, res) => {
  if (!canAssignTasks(req.user)) {
    return res.status(403).json({ success: false, message: 'Only Supply Chain Manager (SCM) or COO can manage tasks.' });
  }

  const taskId = Number(req.params.id);
  if (Number.isNaN(taskId)) {
    return res.status(400).json({ success: false, message: 'Invalid task id.' });
  }

  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : null;
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : null;
  const nextStatus = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : null;
  const assignedTo = req.body?.assigned_to != null ? Number(req.body.assigned_to) : null;

  if (nextStatus && !TASK_STATUSES.has(nextStatus)) {
    return res.status(400).json({ success: false, message: 'Invalid status value.' });
  }

  try {
    await ensureTasksTable();

    const existingRes = await pool.query('SELECT * FROM employee_tasks WHERE id = $1 AND assigned_by = $2', [taskId, req.user.id]);
    if (!existingRes.rowCount) {
      return res.status(404).json({ success: false, message: 'Task not found under your assignments.' });
    }

    const existing = existingRes.rows[0];

    let finalAssignedTo = existing.assigned_to;
    if (assignedTo !== null) {
      if (Number.isNaN(assignedTo)) {
        return res.status(400).json({ success: false, message: 'assigned_to must be a valid user id.' });
      }
      const assigneeCheck = await pool.query('SELECT id FROM users WHERE id = $1 AND is_active = TRUE', [assignedTo]);
      if (!assigneeCheck.rowCount) {
        return res.status(404).json({ success: false, message: 'Assigned employee not found or inactive.' });
      }
      finalAssignedTo = assignedTo;
    }

    const finalStatus = nextStatus || existing.status;

    const { rows } = await pool.query(
      `UPDATE employee_tasks
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           assigned_to = $3,
           status = $4,
           updated_at = NOW(),
           completed_at = CASE WHEN $4 = 'completed' THEN COALESCE(completed_at, NOW()) ELSE NULL END
       WHERE id = $5
       RETURNING *`,
      [title, description, finalAssignedTo, finalStatus, taskId]
    );

    return res.json({ success: true, task: rows[0] });
  } catch (err) {
    console.error('❌ manage task error:', err);
    return res.status(500).json({ success: false, message: 'Failed to manage task.' });
  }
});

router.delete('/:id', async (req, res) => {
  if (!canAssignTasks(req.user)) {
    return res.status(403).json({ success: false, message: 'Only Supply Chain Manager (SCM) or COO can delete tasks.' });
  }

  const taskId = Number(req.params.id);
  if (Number.isNaN(taskId)) {
    return res.status(400).json({ success: false, message: 'Invalid task id.' });
  }

  try {
    await ensureTasksTable();
    const result = await pool.query('DELETE FROM employee_tasks WHERE id = $1 AND assigned_by = $2 RETURNING id', [taskId, req.user.id]);
    if (!result.rowCount) {
      return res.status(404).json({ success: false, message: 'Task not found under your assignments.' });
    }
    return res.json({ success: true, message: 'Task deleted successfully.' });
  } catch (err) {
    console.error('❌ delete task error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete task.' });
  }
});

router.get('/my', async (req, res) => {
  try {
    await ensureTasksTable();
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.description, t.status, t.employee_update, t.assigned_at, t.updated_at, t.completed_at,
              assigner.name AS assigned_by_name
       FROM employee_tasks t
       JOIN users assigner ON assigner.id = t.assigned_by
       WHERE t.assigned_to = $1
       ORDER BY t.assigned_at DESC`,
      [req.user.id]
    );

    return res.json({ success: true, tasks: rows });
  } catch (err) {
    console.error('❌ list my tasks error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load tasks.' });
  }
});

router.patch('/:id/status', async (req, res) => {
  const taskId = Number(req.params.id);
  const status = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : '';
  const employeeUpdate = typeof req.body?.employee_update === 'string' ? req.body.employee_update.trim() : null;

  if (Number.isNaN(taskId)) {
    return res.status(400).json({ success: false, message: 'Invalid task id.' });
  }

  if (!TASK_STATUSES.has(status)) {
    return res.status(400).json({ success: false, message: 'status must be one of pending, in_progress, completed, blocked.' });
  }

  try {
    await ensureTasksTable();

    const existing = await pool.query('SELECT assigned_to FROM employee_tasks WHERE id = $1', [taskId]);
    if (!existing.rowCount) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }

    if (existing.rows[0].assigned_to !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only update your own assigned tasks.' });
    }

    const { rows } = await pool.query(
      `UPDATE employee_tasks
       SET status = $1,
           employee_update = COALESCE($2, employee_update),
           updated_at = NOW(),
           completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE NULL END
       WHERE id = $3
       RETURNING *`,
      [status, employeeUpdate, taskId]
    );

    return res.json({ success: true, task: rows[0] });
  } catch (err) {
    console.error('❌ update task status error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update task status.' });
  }
});

module.exports = router;