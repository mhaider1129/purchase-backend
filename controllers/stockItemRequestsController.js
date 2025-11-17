const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const { createNotification } = require('../utils/notificationService');

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_UNIT_LENGTH = 50;

const normalizeText = value => {
  if (value == null) return '';
  return String(value).trim();
};

let ensureColumnsPromise = null;
const ensureStockItemRequestColumns = async () => {
  if (!ensureColumnsPromise) {
    ensureColumnsPromise = (async () => {
      await pool.query(
        'ALTER TABLE stock_item_requests ADD COLUMN IF NOT EXISTS review_notes TEXT'
      );
    })().catch(err => {
      ensureColumnsPromise = null;
      throw err;
    });
  }

  return ensureColumnsPromise;
};

// Create a new stock item request (Warehouse Manager)
const createStockItemRequest = async (req, res, next) => {
  const { name, description, unit } = req.body || {};
  const userId = req.user?.id ?? req.user?.user_id;
  if (userId === undefined || userId === null || String(userId).trim() === '') {
    return next(createHttpError(401, 'Unauthorized: Missing user context'));
  }
  if (!req.user.hasPermission('stock-requests.create')) {
    return next(createHttpError(403, 'You do not have permission to create stock item requests'));
  }

  const normalizedName = normalizeText(name);
  if (!normalizedName) {
    return next(createHttpError(400, 'Item name is required'));
  }

  if (normalizedName.length > MAX_NAME_LENGTH) {
    return next(
      createHttpError(400, `Item name must be ${MAX_NAME_LENGTH} characters or fewer`)
    );
  }

  const normalizedDescription = normalizeText(description) || null;
  if (normalizedDescription && normalizedDescription.length > MAX_DESCRIPTION_LENGTH) {
    return next(
      createHttpError(
        400,
        `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`
      )
    );
  }

  const normalizedUnit = normalizeText(unit) || null;
  if (normalizedUnit && normalizedUnit.length > MAX_UNIT_LENGTH) {
    return next(createHttpError(400, `Unit must be ${MAX_UNIT_LENGTH} characters or fewer`));
  }

  try {
    const duplicateStockItem = await pool.query(
      `SELECT id, unit
         FROM stock_items
        WHERE LOWER(name) = LOWER($1)
        LIMIT 1`,
      [normalizedName]
    );

    if (duplicateStockItem.rowCount > 0) {
      return next(
        createHttpError(
          409,
          'A stock item with this name already exists in inventory' +
            (duplicateStockItem.rows[0].unit
              ? ` (unit: ${duplicateStockItem.rows[0].unit})`
              : '')
        )
      );
    }

    const duplicateRequest = await pool.query(
      `SELECT id, status
         FROM stock_item_requests
        WHERE LOWER(name) = LOWER($1)
          AND status = 'pending'
        LIMIT 1`,
      [normalizedName]
    );

    if (duplicateRequest.rowCount > 0) {
      return next(
        createHttpError(409, 'A pending stock item request with this name and unit already exists')
      );
    }

    const result = await pool.query(
      `INSERT INTO stock_item_requests (name, description, unit, requested_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [normalizedName, normalizedDescription, normalizedUnit, userId]
    );
    res.status(201).json({
      message: 'Stock item request submitted for review',
      request: result.rows[0],
    });
  } catch (err) {
    console.error('❌ Failed to create stock item request:', err.message);
    next(createHttpError(500, 'Failed to create stock item request'));
  }
};

// Fetch stock item requests
const getStockItemRequests = async (req, res, next) => {
  const { id: userId } = req.user;
  try {
    let result;
    if (req.user.hasPermission('stock-requests.review')) {
      result = await pool.query(
        `SELECT * FROM stock_item_requests ORDER BY inserted_at DESC`
      );
    } else if (req.user.hasPermission('stock-requests.create')) {
      result = await pool.query(
        `SELECT * FROM stock_item_requests WHERE requested_by = $1 ORDER BY inserted_at DESC`,
        [userId]
      );
    } else {
      return next(createHttpError(403, 'You do not have permission to view stock item requests'));
    }
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to fetch stock item requests:', err.message);
    next(createHttpError(500, 'Failed to fetch stock item requests'));
  }
};

// Update request status (SCM approval)
const updateStockItemRequestStatus = async (req, res, next) => {
  const { id } = req.params;
  const { status, review_notes: rawReviewNotes } = req.body || {}; // expected 'approved' or 'rejected'
  const { id: userId } = req.user || {};

  const parsedId = Number(id);
  if (!Number.isInteger(parsedId)) {
    return next(createHttpError(400, 'Invalid request identifier'));
  }

  const canReview = req.user?.hasPermission?.('stock-requests.review');
  const canManageStock = req.user?.hasPermission?.('stock-items.manage');

  if (!canReview && !canManageStock) {
    return next(createHttpError(403, 'You do not have permission to approve stock item requests'));
  }

  if (!['approved', 'rejected'].includes(status)) {
    return next(createHttpError(400, 'Invalid status'));
  }

  const reviewNotes = normalizeText(rawReviewNotes) || null;
  if (reviewNotes && reviewNotes.length > MAX_DESCRIPTION_LENGTH) {
    return next(
      createHttpError(
        400,
        `Review notes must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`
      )
    );
  }

  await ensureStockItemRequestColumns();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const triggerExistsRes = await client.query(
      `SELECT EXISTS (
        SELECT 1
          FROM pg_trigger
         WHERE tgname = 'trg_approve_stock_item_request'
           AND NOT tgisinternal
      ) AS exists`
    );

    const hasApprovalTrigger = triggerExistsRes.rows[0]?.exists === true;
    const existingRes = await client.query(
      `SELECT * FROM stock_item_requests WHERE id = $1 FOR UPDATE`,
      [parsedId]
    );

    if (existingRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Request not found'));
    }

    const existingRequest = existingRes.rows[0];

    if (existingRequest.status !== 'pending') {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'This request has already been reviewed'));
    }

    let createdStockItem = null;

    if (status === 'approved') {
      const duplicateItemCheck = await client.query(
        `SELECT id, unit FROM stock_items
          WHERE LOWER(name) = LOWER($1)
          LIMIT 1`,
        [existingRequest.name]
      );

      if (duplicateItemCheck.rowCount > 0) {
        await client.query('ROLLBACK');
        return next(
          createHttpError(
            409,
            'A stock item with this name already exists in inventory' +
              (duplicateItemCheck.rows[0].unit
                ? ` (unit: ${duplicateItemCheck.rows[0].unit})`
                : '')
          )
        );
      }

      if (!hasApprovalTrigger) {
        const stockRes = await client.query(
          `INSERT INTO stock_items (name, description, unit, created_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (name) DO NOTHING
           RETURNING id, name`,
          [
            existingRequest.name,
            existingRequest.description,
            existingRequest.unit,
            existingRequest.requested_by,
          ]
        );

        if (stockRes.rowCount === 0) {
          const conflictItem = await client.query(
            `SELECT id, unit
               FROM stock_items
              WHERE LOWER(name) = LOWER($1)
              LIMIT 1`,
            [existingRequest.name]
          );

          await client.query('ROLLBACK');
          return next(
            createHttpError(
              409,
              'A stock item with this name already exists in inventory' +
                (conflictItem.rows?.[0]?.unit
                  ? ` (unit: ${conflictItem.rows[0].unit})`
                  : '')
            )
          );
        }

        createdStockItem = stockRes.rows[0] || null;
      }
    }

    const updateRes = await client.query(
      `UPDATE stock_item_requests
         SET status = $1, approved_by = $2, review_notes = $3
       WHERE id = $4
       RETURNING *`,
      [status, userId, reviewNotes, parsedId]
    );

    const updatedRequest = updateRes.rows[0];

    if (status === 'approved' && hasApprovalTrigger && !createdStockItem) {
      const createdItemLookup = await client.query(
        `SELECT id, name, unit
           FROM stock_items
          WHERE LOWER(name) = LOWER($1)
          ORDER BY id DESC
          LIMIT 1`,
        [existingRequest.name]
      );

      createdStockItem = createdItemLookup.rows[0] || null;
    }

    const auditDescription =
      status === 'approved'
        ? `Approved stock item request ${parsedId} for ${existingRequest.name}${
            createdStockItem ? ` (created stock item ${createdStockItem.id})` : ''
          }`
        : `Rejected stock item request ${parsedId} for ${existingRequest.name}${
            reviewNotes ? `: ${reviewNotes}` : ''
          }`;

    await client.query(
      `INSERT INTO audit_logs (action, actor_id, target_id, description)
       VALUES ($1, $2, $3, $4)`,
      [
        status === 'approved'
          ? 'Stock Item Request Approved'
          : 'Stock Item Request Rejected',
        userId,
        parsedId,
        auditDescription,
      ]
    );

    const recipientId = existingRequest.requested_by;
    if (Number.isInteger(recipientId)) {
      const notificationMessage =
        status === 'approved'
          ? `Your stock item request for "${existingRequest.name}" was approved${
              createdStockItem ? ' and added to stock items.' : '.'
            }`
          : `Your stock item request for "${existingRequest.name}" was rejected${
              reviewNotes ? `: ${reviewNotes}` : '.'
            }`;

      await createNotification(
        {
          userId: recipientId,
          title: 'Stock item request review',
          message: notificationMessage,
          metadata: { requestId: parsedId, status },
        },
        client
      );
    }

    await client.query('COMMIT');
    res.json({ ...updatedRequest, created_stock_item: createdStockItem });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to update stock item request status:', err.message);
    next(createHttpError(500, 'Failed to update stock item request status'));
  } finally {
    client.release();
  }
};

module.exports = {
  createStockItemRequest,
  getStockItemRequests,
  updateStockItemRequestStatus,
};