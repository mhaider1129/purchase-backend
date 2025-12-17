const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const { ensureSuppliersTable, findOrCreateSupplierByName } = require('./suppliersController');

let rfxTablesEnsured = false;
let ensuringPromise = null;

const ensureRfxTables = async () => {
  if (rfxTablesEnsured) {
    return;
  }

  if (!ensuringPromise) {
    ensuringPromise = (async () => {
      try {
        await ensureSuppliersTable();

        await pool.query(`
          CREATE TABLE IF NOT EXISTS rfx_events (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            rfx_type TEXT NOT NULL,
            description TEXT,
            due_date TIMESTAMPTZ,
            status TEXT NOT NULL DEFAULT 'open',
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await pool.query(`
          CREATE TABLE IF NOT EXISTS rfx_responses (
            id SERIAL PRIMARY KEY,
            rfx_id INTEGER NOT NULL REFERENCES rfx_events(id) ON DELETE CASCADE,
            supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
            submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            bid_amount NUMERIC,
            notes TEXT,
            response_data JSONB,
            status TEXT NOT NULL DEFAULT 'submitted',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await pool.query(`
          CREATE INDEX IF NOT EXISTS rfx_responses_rfx_id_idx ON rfx_responses(rfx_id);
        `);

        rfxTablesEnsured = true;
      } finally {
        ensuringPromise = null;
      }
    })();
  }

  await ensuringPromise;
};

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const userHasRole = (user, ...roles) => {
  const normalizedRole = user?.role?.toLowerCase?.() ?? '';
  return roles.some((role) => normalizedRole === String(role).toLowerCase());
};

const canManageRfx = (user) =>
  user?.hasPermission?.('rfx.manage') || userHasRole(user, 'scm', 'procurementspecialist');

const canRespondToRfx = (user) =>
  user?.hasPermission?.('rfx.respond') || userHasRole(user, 'supplier', 'contractmanager');

const listRfxEvents = async (req, res, next) => {
  try {
    await ensureRfxTables();

    const statusFilter = normalizeText(req.query?.status);
    const allowedStatuses = new Set(['open', 'draft', 'closed', 'awarded', 'cancelled']);
    const applyStatus = statusFilter && allowedStatuses.has(statusFilter);

    const { rows } = await pool.query(
      `SELECT e.id,
              e.title,
              e.rfx_type,
              e.description,
              e.due_date,
              e.status,
              e.created_by,
              e.created_at,
              e.updated_at,
              COALESCE(resp.response_count, 0) AS response_count,
              resp.last_submitted_at
         FROM rfx_events e
         LEFT JOIN (
           SELECT rfx_id, COUNT(*) AS response_count, MAX(created_at) AS last_submitted_at
             FROM rfx_responses
            GROUP BY rfx_id
         ) resp ON resp.rfx_id = e.id
        WHERE ($1::TEXT IS NULL OR e.status = $1)
        ORDER BY e.created_at DESC`,
      [applyStatus ? statusFilter : null]
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to list RFX events:', err);
    next(createHttpError(500, 'Failed to load RFX events'));
  }
};

const createRfxEvent = async (req, res, next) => {
  if (!canManageRfx(req.user)) {
    return next(createHttpError(403, 'You are not authorized to publish RFX events'));
  }

  const title = normalizeText(req.body?.title);
  const rfxType = normalizeText(req.body?.rfx_type || req.body?.type).toLowerCase();
  const description = normalizeText(req.body?.description) || null;
  const dueDateRaw = normalizeText(req.body?.due_date);
  const allowedTypes = new Set(['rfq', 'rfp', 'rfi', 'itt', 'rft']);

  if (!title) {
    return next(createHttpError(400, 'Title is required'));
  }

  if (!allowedTypes.has(rfxType)) {
    return next(createHttpError(400, 'Invalid RFX type. Use RFQ, RFP, RFI, ITT, or RFT'));
  }

  const dueDate = dueDateRaw ? new Date(dueDateRaw) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) {
    return next(createHttpError(400, 'Invalid due date'));
  }

  try {
    await ensureRfxTables();

    const { rows } = await pool.query(
      `INSERT INTO rfx_events (title, rfx_type, description, due_date, status, created_by)
       VALUES ($1, $2, $3, $4, 'open', $5)
       RETURNING id, title, rfx_type, description, due_date, status, created_by, created_at, updated_at`,
      [title, rfxType.toUpperCase(), description, dueDate, req.user?.id || null]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to create RFX event:', err);
    next(createHttpError(500, 'Failed to create RFX event'));
  }
};

const submitRfxResponse = async (req, res, next) => {
  const hasPrivilegedAccess = canRespondToRfx(req.user) || canManageRfx(req.user);

  if (!hasPrivilegedAccess && req.user) {
    return next(createHttpError(403, 'You are not authorized to submit responses'));
  }

  const rfxId = Number(req.params.id);
  const supplierName = normalizeText(req.body?.supplier_name);
  const bidAmount = req.body?.bid_amount !== undefined ? Number(req.body.bid_amount) : null;
  const notes = normalizeText(req.body?.notes) || null;
  const responseData = req.body?.response_data || req.body?.details || null;

  if (!Number.isInteger(rfxId) || rfxId <= 0) {
    return next(createHttpError(400, 'Invalid RFX id'));
  }

  if (!supplierName) {
    return next(createHttpError(400, 'Supplier name is required'));
  }

  if (bidAmount !== null && Number.isNaN(bidAmount)) {
    return next(createHttpError(400, 'Bid amount must be a number'));
  }

  try {
    await ensureRfxTables();

    const existingEvent = await pool.query(
      `SELECT id, status, due_date FROM rfx_events WHERE id = $1 LIMIT 1`,
      [rfxId]
    );

    if (existingEvent.rowCount === 0) {
      return next(createHttpError(404, 'RFX event not found'));
    }

    const event = existingEvent.rows[0];
    if (['closed', 'cancelled'].includes(event.status?.toLowerCase?.())) {
      return next(createHttpError(400, 'This RFX event is no longer accepting responses'));
    }

    if (event.due_date) {
      const dueDate = new Date(event.due_date);
      if (!Number.isNaN(dueDate.getTime()) && dueDate.getTime() < Date.now()) {
        return next(createHttpError(400, 'The due date for this RFX has passed'));
      }
    }

    const supplier = await findOrCreateSupplierByName(pool, supplierName);

    const { rows } = await pool.query(
      `INSERT INTO rfx_responses (rfx_id, supplier_id, submitted_by, bid_amount, notes, response_data)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, rfx_id, supplier_id, bid_amount, notes, response_data, status, created_at`,
      [rfxId, supplier.id, req.user?.id || null, bidAmount, notes, responseData]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to submit RFX response:', err);
    next(createHttpError(500, 'Failed to submit response'));
  }
};

const listRfxResponses = async (req, res, next) => {
  if (!canManageRfx(req.user)) {
    return next(createHttpError(403, 'You are not authorized to view responses'));
  }

  const rfxId = Number(req.params.id);
  if (!Number.isInteger(rfxId) || rfxId <= 0) {
    return next(createHttpError(400, 'Invalid RFX id'));
  }

  try {
    await ensureRfxTables();

    const { rows } = await pool.query(
      `SELECT resp.id,
              resp.rfx_id,
              resp.bid_amount,
              resp.notes,
              resp.response_data,
              resp.status,
              resp.created_at,
              s.name AS supplier_name
         FROM rfx_responses resp
         LEFT JOIN suppliers s ON s.id = resp.supplier_id
        WHERE resp.rfx_id = $1
        ORDER BY resp.created_at DESC`,
      [rfxId]
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to list RFX responses:', err);
    next(createHttpError(500, 'Failed to load responses'));
  }
};

const updateRfxStatus = async (req, res, next) => {
  if (!canManageRfx(req.user)) {
    return next(createHttpError(403, 'You are not authorized to manage RFX events'));
  }

  const rfxId = Number(req.params.id);
  const status = normalizeText(req.body?.status).toLowerCase();
  const allowedStatuses = new Set(['open', 'closed', 'awarded', 'cancelled', 'draft']);

  if (!Number.isInteger(rfxId) || rfxId <= 0) {
    return next(createHttpError(400, 'Invalid RFX id'));
  }

  if (!allowedStatuses.has(status)) {
    return next(createHttpError(400, 'Invalid status'));
  }

  try {
    await ensureRfxTables();

    const { rowCount, rows } = await pool.query(
      `UPDATE rfx_events
          SET status = $1,
              updated_at = NOW()
        WHERE id = $2
        RETURNING id, title, rfx_type, description, due_date, status, created_by, created_at, updated_at`,
      [status, rfxId]
    );

    if (rowCount === 0) {
      return next(createHttpError(404, 'RFX event not found'));
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to update RFX status:', err);
    next(createHttpError(500, 'Failed to update RFX status'));
  }
};

module.exports = {
  listRfxEvents,
  createRfxEvent,
  submitRfxResponse,
  listRfxResponses,
  updateRfxStatus,
};