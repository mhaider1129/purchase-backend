const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

const ensureAuditRegistryTable = async client => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.audit_registry_entries (
      id BIGSERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
      requester_id INTEGER NOT NULL REFERENCES public.users(id),
      requester_type TEXT NOT NULL CHECK (requester_type IN ('INDIVIDUAL','COMMITTEE')),
      account_name TEXT,
      notes TEXT,
      required_before_payment TEXT,
      required_after_payment TEXT,
      audit_status TEXT NOT NULL DEFAULT 'PENDING_AUDIT' CHECK (audit_status IN ('PENDING_AUDIT','ACTION_REQUIRED','READY_FOR_FINANCE','FINANCE_PROCESSING','COMPLETED')),
      finance_issued_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      returned_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      completed_at TIMESTAMPTZ,
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
};

const assertValidStatus = status => {
  const statuses = new Set(['PENDING_AUDIT', 'ACTION_REQUIRED', 'READY_FOR_FINANCE', 'FINANCE_PROCESSING', 'COMPLETED']);
  if (!statuses.has(status)) {
    throw createHttpError(400, 'Invalid audit status');
  }
};

const createAuditEntry = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const requestId = Number(req.params.requestId);
    if (!Number.isInteger(requestId) || requestId <= 0) throw createHttpError(400, 'Invalid request id');

    const {
      requester_type = 'INDIVIDUAL',
      account_name = null,
      notes = null,
      required_before_payment = null,
      required_after_payment = null,
      audit_status = 'PENDING_AUDIT',
      finance_issued_amount = 0,
      returned_amount = 0,
      currency = 'USD',
    } = req.body;

    assertValidStatus(audit_status);
    await client.query('BEGIN');
    await ensureAuditRegistryTable(client);

    const requestRes = await client.query('SELECT requester_id FROM requests WHERE id = $1', [requestId]);
    if (!requestRes.rowCount) throw createHttpError(404, 'Request not found');

    const entry = await client.query(
      `INSERT INTO audit_registry_entries
      (request_id, requester_id, requester_type, account_name, notes, required_before_payment, required_after_payment, audit_status, finance_issued_amount, returned_amount, currency, created_by, updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
      RETURNING *, (finance_issued_amount - returned_amount) AS remaining_amount`,
      [
        requestId,
        requestRes.rows[0].requester_id,
        String(requester_type).toUpperCase(),
        account_name,
        notes,
        required_before_payment,
        required_after_payment,
        audit_status,
        Number(finance_issued_amount) || 0,
        Number(returned_amount) || 0,
        currency,
        req.user.id,
      ]
    );

    await client.query('COMMIT');
    res.status(201).json(entry.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

const getMyAuditRequests = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await ensureAuditRegistryTable(client);
    const data = await client.query(
      `SELECT are.*, r.status AS request_status, r.title AS request_title,
              (are.finance_issued_amount - are.returned_amount) AS remaining_amount
       FROM audit_registry_entries are
       JOIN requests r ON r.id = are.request_id
       WHERE are.requester_id = $1
       ORDER BY are.created_at DESC`,
      [req.user.id]
    );
    res.json(data.rows);
  } catch (error) {
    next(error);
  } finally {
    client.release();
  }
};

const updateAuditEntry = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const entryId = Number(req.params.entryId);
    if (!Number.isInteger(entryId) || entryId <= 0) throw createHttpError(400, 'Invalid entry id');
    await client.query('BEGIN');
    await ensureAuditRegistryTable(client);

    const current = await client.query('SELECT * FROM audit_registry_entries WHERE id = $1 FOR UPDATE', [entryId]);
    if (!current.rowCount) throw createHttpError(404, 'Audit entry not found');

    const row = current.rows[0];
    const nextStatus = req.body.audit_status || row.audit_status;
    assertValidStatus(nextStatus);

    const updated = await client.query(
      `UPDATE audit_registry_entries
       SET required_before_payment = COALESCE($2, required_before_payment),
           required_after_payment = COALESCE($3, required_after_payment),
           notes = COALESCE($4, notes),
           audit_status = $5,
           finance_issued_amount = COALESCE($6, finance_issued_amount),
           returned_amount = COALESCE($7, returned_amount),
           completed_at = CASE WHEN $5 = 'COMPLETED' THEN NOW() ELSE completed_at END,
           updated_by = $8,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *, (finance_issued_amount - returned_amount) AS remaining_amount`,
      [entryId, req.body.required_before_payment, req.body.required_after_payment, req.body.notes, nextStatus, req.body.finance_issued_amount, req.body.returned_amount, req.user.id]
    );

    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

module.exports = {
  createAuditEntry,
  getMyAuditRequests,
  updateAuditEntry,
};