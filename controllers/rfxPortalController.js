const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const { ensureSuppliersTable, findOrCreateSupplierByName } = require('./suppliersController');

let rfxTablesEnsured = false;
let ensuringPromise = null;
let purchaseOrdersEnsured = false;
let purchaseOrdersEnsuringPromise = null;
let requestAwardColumnsEnsured = false;
let requestAwardColumnsEnsuringPromise = null;

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
            request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
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
            request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
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

        await pool.query(`
          ALTER TABLE rfx_events
            ADD COLUMN IF NOT EXISTS request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL;
        `);

        await pool.query(`
          ALTER TABLE rfx_responses
            ADD COLUMN IF NOT EXISTS request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL;
        `);

        await pool.query(`
          CREATE INDEX IF NOT EXISTS rfx_events_request_id_idx ON rfx_events(request_id);
        `);

        await pool.query(`
          CREATE INDEX IF NOT EXISTS rfx_responses_request_id_idx ON rfx_responses(request_id);
        `);

        rfxTablesEnsured = true;
      } finally {
        ensuringPromise = null;
      }
    })();
  }

  await ensuringPromise;
};

const ensurePurchaseOrderTables = async () => {
  if (purchaseOrdersEnsured) {
    return;
  }

  if (!purchaseOrdersEnsuringPromise) {
    purchaseOrdersEnsuringPromise = (async () => {
      try {
        await ensureSuppliersTable();

        await pool.query(`
          CREATE TABLE IF NOT EXISTS purchase_orders (
            id SERIAL PRIMARY KEY,
            request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            rfx_id INTEGER REFERENCES rfx_events(id) ON DELETE SET NULL,
            rfx_response_id INTEGER REFERENCES rfx_responses(id) ON DELETE SET NULL,
            supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
            po_number TEXT UNIQUE,
            status TEXT NOT NULL DEFAULT 'issued',
            currency TEXT DEFAULT 'USD',
            total_amount NUMERIC,
            notes TEXT,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            issued_at TIMESTAMPTZ DEFAULT NOW(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await pool.query(
          `CREATE INDEX IF NOT EXISTS purchase_orders_request_id_idx ON purchase_orders(request_id)`
        );
        await pool.query(
          `CREATE INDEX IF NOT EXISTS purchase_orders_rfx_id_idx ON purchase_orders(rfx_id)`
        );
      } finally {
        purchaseOrdersEnsuringPromise = null;
        purchaseOrdersEnsured = true;
      }
    })();
  }

  await purchaseOrdersEnsuringPromise;
};

const ensureRequestAwardColumns = async () => {
  if (requestAwardColumnsEnsured) {
    return;
  }

  if (!requestAwardColumnsEnsuringPromise) {
    requestAwardColumnsEnsuringPromise = (async () => {
      try {
        await ensurePurchaseOrderTables();

        await pool.query(`
          ALTER TABLE requests
            ADD COLUMN IF NOT EXISTS awarded_supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS awarded_rfx_id INTEGER REFERENCES rfx_events(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS awarded_rfx_response_id INTEGER REFERENCES rfx_responses(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS purchase_order_id INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS purchase_order_number TEXT,
            ADD COLUMN IF NOT EXISTS sourcing_status TEXT,
            ADD COLUMN IF NOT EXISTS awarded_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS po_issued_at TIMESTAMPTZ;
        `);

        requestAwardColumnsEnsured = true;
      } finally {
        requestAwardColumnsEnsuringPromise = null;
      }
    })();
  }

  await requestAwardColumnsEnsuringPromise;
};

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const clampScore = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric < 0) return 0;
  if (numeric > 100) return 100;
  return numeric;
};

const normalizeBidAmount = (value) => {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
};

const generatePoNumber = () =>
  `PO-${Date.now()}-${Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, '0')}`;

const calculatePriceScore = (bidAmount, minBid, maxBid) => {
  if (!Number.isFinite(bidAmount) || minBid === null || maxBid === null) return null;
  if (maxBid === minBid) return 100;

  const distanceFromMin = maxBid - bidAmount;
  const priceRange = maxBid - minBid;
  const normalized = (distanceFromMin / priceRange) * 100;
  return clampScore(normalized, 0);
};

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
              e.request_id,
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
  const requestIdRaw = req.body?.request_id ?? req.body?.requestId;
  const dueDateRaw = normalizeText(req.body?.due_date);
  const allowedTypes = new Set(['rfq', 'rfp', 'rfi', 'itt', 'rft']);
  const requestId = requestIdRaw !== undefined && requestIdRaw !== null ? Number(requestIdRaw) : null;

  if (!title) {
    return next(createHttpError(400, 'Title is required'));
  }

  if (!allowedTypes.has(rfxType)) {
    return next(createHttpError(400, 'Invalid RFX type. Use RFQ, RFP, RFI, ITT, or RFT'));
  }

  if (requestId !== null && (!Number.isInteger(requestId) || requestId <= 0)) {
    return next(createHttpError(400, 'Invalid request_id; provide a valid requisition id'));
  }

  const dueDate = dueDateRaw ? new Date(dueDateRaw) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) {
    return next(createHttpError(400, 'Invalid due date'));
  }

  try {
    await ensureRfxTables();
    await ensureRequestAwardColumns();

    if (requestId !== null) {
      const { rowCount } = await pool.query(
        `SELECT 1 FROM requests WHERE id = $1 LIMIT 1`,
        [requestId]
      );

      if (rowCount === 0) {
        return next(createHttpError(404, 'Linked request not found'));
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO rfx_events (title, rfx_type, description, request_id, due_date, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'open', $6)
       RETURNING id, title, rfx_type, description, request_id, due_date, status, created_by, created_at, updated_at`,
      [title, rfxType.toUpperCase(), description, requestId, dueDate, req.user?.id || null]
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
      `SELECT id, status, due_date, request_id FROM rfx_events WHERE id = $1 LIMIT 1`,
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
      `INSERT INTO rfx_responses (rfx_id, request_id, supplier_id, submitted_by, bid_amount, notes, response_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, rfx_id, request_id, supplier_id, bid_amount, notes, response_data, status, created_at`,
      [rfxId, event.request_id, supplier.id, req.user?.id || null, bidAmount, notes, responseData]
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
              resp.request_id,
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

const analyzeQuotations = async (req, res, next) => {
  if (!canManageRfx(req.user)) {
    return next(createHttpError(403, 'You are not authorized to analyze quotations'));
  }

  const rfxId = Number(req.params.id);
  const quotations = Array.isArray(req.body?.quotations) ? req.body.quotations : [];

  if (!Number.isInteger(rfxId) || rfxId <= 0) {
    return next(createHttpError(400, 'Invalid RFX id'));
  }

  if (quotations.length === 0) {
    return next(createHttpError(400, 'Provide at least one quotation to analyze'));
  }

  try {
    await ensureRfxTables();

    const existingEvent = await pool.query(
      `SELECT id FROM rfx_events WHERE id = $1 LIMIT 1`,
      [rfxId]
    );

    if (existingEvent.rowCount === 0) {
      return next(createHttpError(404, 'RFX event not found'));
    }

    const bidValues = quotations
      .map((quote) => normalizeBidAmount(quote?.bid_amount))
      .filter((value) => value !== null);
    const minBid = bidValues.length ? Math.min(...bidValues) : null;
    const maxBid = bidValues.length ? Math.max(...bidValues) : null;

    const weightedResults = quotations.map((quote, index) => {
      const supplierName = normalizeText(quote?.supplier_name) || `Supplier ${index + 1}`;
      const bidAmount = normalizeBidAmount(quote?.bid_amount);
      const safetyScore = clampScore(quote?.safety_score ?? quote?.safety);
      const valueScore = clampScore(quote?.value_score ?? quote?.value);
      const jciScore = clampScore(
        quote?.jci_score ?? quote?.jci_compliance_score ?? quote?.jci_compliance
      );
      const deliveryScore = clampScore(quote?.delivery_score ?? quote?.delivery);

      const priceScore = calculatePriceScore(bidAmount, minBid, maxBid);

      // Weighted formula tuned for price/value competitiveness with safety and JCI compliance
      const combinedScore =
        (priceScore ?? 0) * 0.3 + valueScore * 0.3 + safetyScore * 0.25 + jciScore * 0.1 + deliveryScore * 0.05;

      return {
        supplier_name: supplierName,
        bid_amount: bidAmount,
        safety_score: safetyScore,
        value_score: valueScore,
        jci_score: jciScore,
        delivery_score: deliveryScore,
        price_score: priceScore,
        composite_score: Number(combinedScore.toFixed(2)),
        notes: normalizeText(quote?.notes) || null,
      };
    });

    const rankings = weightedResults
      .sort((a, b) => b.composite_score - a.composite_score)
      .map((result, position) => ({ ...result, rank: position + 1 }));

    res.json({
      rfx_id: rfxId,
      evaluated_on: new Date().toISOString(),
      best_quotation: rankings[0],
      rankings,
    });
  } catch (err) {
    console.error('❌ Failed to analyze quotations:', err);
    next(createHttpError(500, 'Failed to analyze quotations'));
  }
};

const awardRfxResponse = async (req, res, next) => {
  if (!canManageRfx(req.user)) {
    return next(createHttpError(403, 'You are not authorized to award RFX events'));
  }

  const rfxId = Number(req.params.id);
  const responseIdRaw =
    req.body?.response_id ?? req.body?.rfx_response_id ?? req.body?.rfxResponseId;
  const poNumberInput = normalizeText(req.body?.po_number ?? req.body?.poNumber);
  const awardNotes = normalizeText(req.body?.notes) || null;
  const responseId =
    responseIdRaw !== undefined && responseIdRaw !== null ? Number(responseIdRaw) : null;

  if (!Number.isInteger(rfxId) || rfxId <= 0) {
    return next(createHttpError(400, 'Invalid RFX id'));
  }

  if (!Number.isInteger(responseId) || responseId <= 0) {
    return next(createHttpError(400, 'Invalid response_id; select a valid supplier response to award'));
  }

  await ensureRfxTables();
  await ensureRequestAwardColumns();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const responseRes = await client.query(
      `SELECT resp.id,
              resp.rfx_id,
              resp.request_id,
              resp.supplier_id,
              resp.bid_amount,
              resp.status AS response_status,
              evt.request_id AS event_request_id,
              evt.status AS event_status
         FROM rfx_responses resp
         JOIN rfx_events evt ON evt.id = resp.rfx_id
        WHERE resp.id = $1
          AND resp.rfx_id = $2
        FOR UPDATE`,
      [responseId, rfxId]
    );

    if (responseRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'RFX response not found for this event'));
    }

    const responseRow = responseRes.rows[0];
    const requestId = responseRow.request_id || responseRow.event_request_id;

    if (!requestId) {
      await client.query('ROLLBACK');
      return next(
        createHttpError(
          400,
          'RFX must be linked to a requisition before awarding a supplier'
        )
      );
    }

    if (responseRow.event_status && ['cancelled'].includes(responseRow.event_status.toLowerCase())) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'Cannot award a cancelled RFX'));
    }

    const requestRes = await client.query(
      `SELECT id, status, sourcing_status, purchase_order_id
         FROM requests
        WHERE id = $1
        FOR UPDATE`,
      [requestId]
    );

    if (requestRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Linked request not found'));
    }

    const normalizedPoNumber = poNumberInput || generatePoNumber();

    const existingPo = await client.query(
      `SELECT id, po_number FROM purchase_orders WHERE request_id = $1 LIMIT 1`,
      [requestId]
    );

    if (existingPo.rowCount > 0) {
      await client.query('ROLLBACK');
      return next(
        createHttpError(400, `Request already has a purchase order (${existingPo.rows[0].po_number})`)
      );
    }

    const poInsert = await client.query(
      `INSERT INTO purchase_orders (request_id, rfx_id, rfx_response_id, supplier_id, po_number, total_amount, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, request_id, rfx_id, rfx_response_id, supplier_id, po_number, status, total_amount, notes, issued_at, created_at`,
      [
        requestId,
        rfxId,
        responseId,
        responseRow.supplier_id,
        normalizedPoNumber,
        responseRow.bid_amount,
        awardNotes,
        req.user?.id || null,
      ]
    );

    await client.query(
      `UPDATE rfx_responses
          SET status = CASE WHEN id = $1 THEN 'awarded' ELSE 'closed' END
        WHERE rfx_id = $2`,
      [responseId, rfxId]
    );

    await client.query(
      `UPDATE rfx_events
          SET status = 'awarded',
              updated_at = NOW(),
              request_id = COALESCE(request_id, $2)
        WHERE id = $1`,
      [rfxId, requestId]
    );

    const poRow = poInsert.rows[0];

    const requestUpdate = await client.query(
      `UPDATE requests
          SET awarded_supplier_id = $1,
              awarded_rfx_id = $2,
              awarded_rfx_response_id = $3,
              purchase_order_id = $4,
              purchase_order_number = $5,
              sourcing_status = 'po_issued',
              awarded_at = COALESCE(awarded_at, NOW()),
              po_issued_at = COALESCE(po_issued_at, NOW())
        WHERE id = $6
        RETURNING id, status, sourcing_status, purchase_order_id, purchase_order_number, awarded_supplier_id`,
      [
        responseRow.supplier_id,
        rfxId,
        responseId,
        poRow.id,
        poRow.po_number,
        requestId,
      ]
    );

    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, 'RFX Awarded', $2, $3)`,
      [
        requestId,
        req.user?.id || null,
        `Awarded supplier response ${responseId} with PO ${poRow.po_number}`,
      ]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Supplier awarded and purchase order issued',
      rfx_id: rfxId,
      request_id: requestId,
      awarded_response_id: responseId,
      purchase_order: poRow,
      request: requestUpdate.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to award RFX response:', err);
    next(createHttpError(500, 'Failed to award supplier and issue purchase order'));
  } finally {
    client.release();
  }
};

module.exports = {
  listRfxEvents,
  createRfxEvent,
  submitRfxResponse,
  listRfxResponses,
  updateRfxStatus,
  analyzeQuotations,
  awardRfxResponse,
};