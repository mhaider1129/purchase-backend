const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

const AUDIT_STATUSES = {
  COO_REVIEW_PENDING: 'COO_REVIEW_PENDING',
  AUDIT_REVIEW_PENDING: 'AUDIT_REVIEW_PENDING',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  REGISTERED: 'REGISTERED',
  CLOSED: 'CLOSED',
};

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
      audit_status TEXT NOT NULL DEFAULT 'COO_REVIEW_PENDING' CHECK (audit_status IN ('COO_REVIEW_PENDING','AUDIT_REVIEW_PENDING','ACTION_REQUIRED','REGISTERED','CLOSED')),
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
  const statuses = new Set(Object.values(AUDIT_STATUSES));
  if (!statuses.has(status)) {
    throw createHttpError(400, 'Invalid audit status');
  }
};

const normalizeRole = role => String(role || '').trim().toUpperCase();

const assertWorkflowTransitionAllowed = ({ currentStatus, nextStatus, role, requesterId, actorId }) => {
  const isRequester = requesterId === actorId;
  if (currentStatus === nextStatus) return;

  if (currentStatus === AUDIT_STATUSES.COO_REVIEW_PENDING && nextStatus === AUDIT_STATUSES.AUDIT_REVIEW_PENDING) {
    if (role !== 'COO') throw createHttpError(403, 'Only COO can approve this request for audit review');
    return;
  }

  if (currentStatus === AUDIT_STATUSES.AUDIT_REVIEW_PENDING && nextStatus === AUDIT_STATUSES.REGISTERED) {
    if (role !== 'AUDIT') throw createHttpError(403, 'Only Audit can approve and register this request');
    return;
  }

  if (currentStatus === AUDIT_STATUSES.REGISTERED && nextStatus === AUDIT_STATUSES.CLOSED) {
    if (role !== 'AUDIT') throw createHttpError(403, 'Only Audit can close this registry');
    return;
  }

  if (nextStatus === AUDIT_STATUSES.ACTION_REQUIRED) {
    if (role !== 'AUDIT') throw createHttpError(403, 'Only Audit can set required actions for the user');
    return;
  }

  if (currentStatus === AUDIT_STATUSES.ACTION_REQUIRED && nextStatus === AUDIT_STATUSES.REGISTERED) {
    if (!isRequester && role !== 'AUDIT') {
      throw createHttpError(403, 'Only the requester or Audit can mark requirements as fulfilled');
    }
    return;
  }

  throw createHttpError(400, `Invalid workflow transition from ${currentStatus} to ${nextStatus}`);
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
      audit_status = AUDIT_STATUSES.COO_REVIEW_PENDING,
      finance_issued_amount = 0,
      returned_amount = 0,
      currency = 'USD',
    } = req.body;

    const normalizedRole = normalizeRole(req.user.role);
    const normalizedStatus = String(audit_status || AUDIT_STATUSES.COO_REVIEW_PENDING).toUpperCase();
    assertValidStatus(normalizedStatus);
    if (normalizedRole !== 'REQUESTER' && normalizedRole !== 'USER' && normalizedRole !== 'INDIVIDUAL') {
      throw createHttpError(403, 'Only a requester can submit a new finance registry request');
    }
    if (normalizedStatus !== AUDIT_STATUSES.COO_REVIEW_PENDING) {
      throw createHttpError(400, 'New registry requests must start in COO_REVIEW_PENDING status');
    }
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
        normalizedStatus,
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
      `SELECT are.*, r.status AS request_status, r.request_type AS request_title,
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
    const nextStatus = String(req.body.audit_status || row.audit_status).toUpperCase();
    const normalizedRole = normalizeRole(req.user.role);
    assertValidStatus(nextStatus);
    assertWorkflowTransitionAllowed({
      currentStatus: row.audit_status,
      nextStatus,
      role: normalizedRole,
      requesterId: row.requester_id,
      actorId: req.user.id,
    });

    if (nextStatus === AUDIT_STATUSES.CLOSED && (Number(req.body.returned_amount) || row.returned_amount) < row.finance_issued_amount) {
      throw createHttpError(400, 'Returned amount must cover the registered amount before closing');
    }

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