const express = require('express');
const pool = require('../config/db');

const router = express.Router();

const STATUSES = new Set(['submitted', 'accepted', 'completed', 'claimed', 'cancelled']);

let ensurePrintServiceTablePromise;

const ensurePrintServiceTables = async () => {
  if (!ensurePrintServiceTablePromise) {
    ensurePrintServiceTablePromise = pool.query(`
      CREATE TABLE IF NOT EXISTS print_service_requests (
        id SERIAL PRIMARY KEY,
        requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
        section_id INTEGER,
        form_name TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'submitted',
        accepted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        accepted_at TIMESTAMPTZ,
        completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        completed_at TIMESTAMPTZ,
        claimed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_print_service_requests_requester ON print_service_requests (requester_id);
      CREATE INDEX IF NOT EXISTS idx_print_service_requests_status ON print_service_requests (status);
      CREATE INDEX IF NOT EXISTS idx_print_service_requests_accepted_by ON print_service_requests (accepted_by);
      CREATE INDEX IF NOT EXISTS idx_print_service_requests_created_at ON print_service_requests (created_at DESC);
    `);
  }

  return ensurePrintServiceTablePromise;
};

const normalize = (value) => String(value || '').trim().toLowerCase();

const isItUser = async (user) => {
  const role = normalize(user?.role);
  if (role.includes('it')) return true;

  const { rows } = await pool.query(
    `SELECT d.name AS department_name
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.id = $1`,
    [user?.id]
  );

  return normalize(rows[0]?.department_name).includes('it');
};

const mapRow = (row) => ({
  id: row.id,
  form_name: row.form_name,
  quantity: row.quantity,
  notes: row.notes,
  status: row.status,
  created_at: row.created_at,
  updated_at: row.updated_at,
  accepted_at: row.accepted_at,
  completed_at: row.completed_at,
  claimed_at: row.claimed_at,
  requester_name: row.requester_name,
  requester_department: row.requester_department,
  accepted_by_name: row.accepted_by_name,
  completed_by_name: row.completed_by_name,
});

const selectSql = `
  SELECT psr.*,
         requester.name AS requester_name,
         department.name AS requester_department,
         accepted_user.name AS accepted_by_name,
         completed_user.name AS completed_by_name
  FROM print_service_requests psr
  JOIN users requester ON requester.id = psr.requester_id
  LEFT JOIN departments department ON department.id = psr.department_id
  LEFT JOIN users accepted_user ON accepted_user.id = psr.accepted_by
  LEFT JOIN users completed_user ON completed_user.id = psr.completed_by
`;

router.post('/', async (req, res) => {
  const formName = typeof req.body?.form_name === 'string' ? req.body.form_name.trim() : '';
  const quantity = Number(req.body?.quantity);
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : null;

  if (!formName) {
    return res.status(400).json({ success: false, message: 'Log or form name is required.' });
  }

  if (!Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ success: false, message: 'Quantity must be a whole number greater than zero.' });
  }

  try {
    await ensurePrintServiceTables();
    const { rows } = await pool.query(
      `INSERT INTO print_service_requests (requester_id, department_id, section_id, form_name, quantity, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.id, req.user.department_id || null, req.user.section_id || null, formName, quantity, notes]
    );

    return res.status(201).json({ success: true, request: rows[0] });
  } catch (err) {
    console.error('❌ create print service request error:', err);
    return res.status(500).json({ success: false, message: 'Failed to submit print service request.' });
  }
});

router.get('/my', async (req, res) => {
  try {
    await ensurePrintServiceTables();
    const { rows } = await pool.query(
      `${selectSql} WHERE psr.requester_id = $1 ORDER BY psr.created_at DESC`,
      [req.user.id]
    );
    return res.json({ success: true, requests: rows.map(mapRow) });
  } catch (err) {
    console.error('❌ list my print service requests error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load print service requests.' });
  }
});

router.get('/queue', async (req, res) => {
  try {
    await ensurePrintServiceTables();
    if (!(await isItUser(req.user))) {
      return res.status(403).json({ success: false, message: 'Only IT Department users can view print service requests.' });
    }

    const { rows } = await pool.query(
      `${selectSql} ORDER BY CASE psr.status WHEN 'submitted' THEN 1 WHEN 'accepted' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END, psr.created_at ASC`
    );
    return res.json({ success: true, requests: rows.map(mapRow) });
  } catch (err) {
    console.error('❌ list print service queue error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load print service queue.' });
  }
});

router.patch('/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  const nextStatus = normalize(req.body?.status);

  if (!Number.isInteger(id) || !STATUSES.has(nextStatus)) {
    return res.status(400).json({ success: false, message: 'Valid request id and status are required.' });
  }

  try {
    await ensurePrintServiceTables();
    const userIsIt = await isItUser(req.user);
    if (!userIsIt && nextStatus !== 'claimed') {
      return res.status(403).json({ success: false, message: 'Only IT Department users can update print service workflow status.' });
    }

    const existing = await pool.query('SELECT * FROM print_service_requests WHERE id = $1', [id]);
    if (!existing.rowCount) {
      return res.status(404).json({ success: false, message: 'Print service request not found.' });
    }

    if (nextStatus === 'claimed' && existing.rows[0].requester_id !== req.user.id && !userIsIt) {
      return res.status(403).json({ success: false, message: 'Only the requester or IT can mark this request as claimed.' });
    }

    const { rows } = await pool.query(
      `UPDATE print_service_requests
       SET status = $1,
           accepted_by = CASE WHEN $1 = 'accepted' THEN $2 ELSE accepted_by END,
           accepted_at = CASE WHEN $1 = 'accepted' THEN COALESCE(accepted_at, NOW()) ELSE accepted_at END,
           completed_by = CASE WHEN $1 = 'completed' THEN $2 ELSE completed_by END,
           completed_at = CASE WHEN $1 = 'completed' THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
           claimed_at = CASE WHEN $1 = 'claimed' THEN COALESCE(claimed_at, NOW()) ELSE claimed_at END,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [nextStatus, req.user.id, id]
    );

    return res.json({ success: true, request: rows[0] });
  } catch (err) {
    console.error('❌ update print service request error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update print service request.' });
  }
});

module.exports = router;