const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const ensureWarehouseAssignments = require('../utils/ensureWarehouseAssignments');
const ensureWarehouseInventoryTables = require('../utils/ensureWarehouseInventoryTables');
const ensureWarehouseTransferTables = require('../utils/ensureWarehouseTransferTables');
const recalculateAvailableQuantity = require('../utils/recalculateAvailableQuantity');

const parseQuantity = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return NaN;
  return parsed;
};

const normalizeItems = (rawItems) => {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return [];
  }

  return rawItems.map((entry) => ({
    stockItemId: Number(entry.stock_item_id ?? entry.stockItemId),
    quantity: parseQuantity(entry.quantity),
    notes: entry.notes ?? null,
  }));
};

const requireWarehouseManager = (req, next) => {
  if (!req.user?.hasPermission('warehouse.manage-supply')) {
    next(createHttpError(403, 'You do not have permission to manage warehouse transfers'));
    return false;
  }
  return true;
};

const createTransferRequest = async (req, res, next) => {
  if (!requireWarehouseManager(req, next)) return;

  const {
    origin_warehouse_id,
    destination_warehouse_id,
    notes,
    items,
  } = req.body || {};

  const originWarehouseId = origin_warehouse_id
    ? Number(origin_warehouse_id)
    : Number(req.user?.warehouse_id);
  const destinationWarehouseId = Number(destination_warehouse_id);

  if (!Number.isInteger(originWarehouseId)) {
    return next(createHttpError(400, 'A valid origin_warehouse_id is required'));
  }

  if (!Number.isInteger(destinationWarehouseId)) {
    return next(createHttpError(400, 'A valid destination_warehouse_id is required'));
  }

  if (originWarehouseId === destinationWarehouseId) {
    return next(createHttpError(400, 'Origin and destination warehouses must be different'));
  }

  const normalizedItems = normalizeItems(items).filter(
    (entry) => Number.isInteger(entry.stockItemId) && Number.isFinite(entry.quantity) && entry.quantity > 0,
  );

  if (normalizedItems.length === 0) {
    return next(createHttpError(400, 'At least one stock item with a positive quantity is required'));
  }

  await ensureWarehouseAssignments();
  await ensureWarehouseInventoryTables();
  await ensureWarehouseTransferTables();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const warehousesRes = await client.query(
      `SELECT id FROM warehouses WHERE id = ANY($1::int[])`,
      [[originWarehouseId, destinationWarehouseId]],
    );

    if (warehousesRes.rowCount !== 2) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'One or more warehouses were not found'));
    }

    const transferRes = await client.query(
      `INSERT INTO warehouse_transfer_requests (
        origin_warehouse_id,
        destination_warehouse_id,
        status,
        notes,
        requested_by
      ) VALUES ($1, $2, 'Pending', $3, $4)
      RETURNING id, origin_warehouse_id, destination_warehouse_id, status, notes, requested_by, created_at`,
      [originWarehouseId, destinationWarehouseId, notes ?? null, req.user.id],
    );

    const transfer = transferRes.rows[0];

    const itemRows = [];

    for (const [index, entry] of normalizedItems.entries()) {
      const stockItemRes = await client.query(
        'SELECT id, name FROM stock_items WHERE id = $1',
        [entry.stockItemId],
      );

      if (stockItemRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return next(createHttpError(404, `Stock item not found for entry #${index + 1}`));
      }

      const itemName = stockItemRes.rows[0].name;

      const itemInsert = await client.query(
        `INSERT INTO warehouse_transfer_items (
          transfer_id,
          stock_item_id,
          item_name,
          quantity,
          notes
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id, stock_item_id, item_name, quantity, notes`,
        [transfer.id, entry.stockItemId, itemName, entry.quantity, entry.notes ?? null],
      );

      itemRows.push(itemInsert.rows[0]);
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Warehouse transfer request created',
      transfer,
      items: itemRows,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to create warehouse transfer request:', error.message);
    next(createHttpError(500, 'Failed to create warehouse transfer request'));
  } finally {
    client.release();
  }
};

const approveTransferRequest = async (req, res, next) => {
  if (!requireWarehouseManager(req, next)) return;

  const transferId = Number(req.params.transferId);
  if (!Number.isInteger(transferId)) {
    return next(createHttpError(400, 'A valid transfer ID is required'));
  }

  await ensureWarehouseAssignments();
  await ensureWarehouseInventoryTables();
  await ensureWarehouseTransferTables();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const transferRes = await client.query(
      `SELECT id, origin_warehouse_id, destination_warehouse_id, status, notes
         FROM warehouse_transfer_requests
        WHERE id = $1
        FOR UPDATE`,
      [transferId],
    );

    if (transferRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Transfer request not found'));
    }

    const transfer = transferRes.rows[0];

    if (transfer.status !== 'Pending') {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'Only pending transfer requests can be approved'));
    }

    const itemsRes = await client.query(
      `SELECT id, stock_item_id, item_name, quantity
         FROM warehouse_transfer_items
        WHERE transfer_id = $1
        ORDER BY id`,
      [transferId],
    );

    if (itemsRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'Transfer request has no items'));
    }

    const originWarehouseId = Number(transfer.origin_warehouse_id);
    const destinationWarehouseId = Number(transfer.destination_warehouse_id);

    if (originWarehouseId === destinationWarehouseId) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'Origin and destination warehouses must be different'));
    }

    const movements = [];

    for (const entry of itemsRes.rows) {
      const stockItemId = Number(entry.stock_item_id);
      const quantity = parseQuantity(entry.quantity);

      if (!Number.isInteger(stockItemId) || !Number.isFinite(quantity) || quantity <= 0) {
        await client.query('ROLLBACK');
        return next(createHttpError(400, 'Invalid transfer item quantity'));
      }

      const originBalanceRes = await client.query(
        `SELECT quantity
           FROM warehouse_stock_levels
          WHERE warehouse_id = $1 AND stock_item_id = $2
          FOR UPDATE`,
        [originWarehouseId, stockItemId],
      );

      if (originBalanceRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return next(
          createHttpError(
            400,
            `Warehouse inventory for ${entry.item_name} is not initialized at the origin warehouse.`,
          ),
        );
      }

      const originQty = Number(originBalanceRes.rows[0].quantity) || 0;
      if (originQty < quantity) {
        await client.query('ROLLBACK');
        return next(
          createHttpError(
            400,
            `Insufficient stock for ${entry.item_name}. Available: ${originQty}, requested: ${quantity}`,
          ),
        );
      }

      await client.query(
        `UPDATE warehouse_stock_levels
            SET quantity = quantity - $3,
                updated_at = CURRENT_TIMESTAMP,
                updated_by = $4
          WHERE warehouse_id = $1 AND stock_item_id = $2`,
        [originWarehouseId, stockItemId, quantity, req.user.id],
      );

      await client.query(
        `INSERT INTO warehouse_stock_levels (
          warehouse_id, stock_item_id, item_name, quantity, updated_by
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (warehouse_id, stock_item_id)
        DO UPDATE SET
          quantity = warehouse_stock_levels.quantity + EXCLUDED.quantity,
          item_name = EXCLUDED.item_name,
          updated_by = EXCLUDED.updated_by,
          updated_at = CURRENT_TIMESTAMP`,
        [destinationWarehouseId, stockItemId, entry.item_name, quantity, req.user.id],
      );

      await recalculateAvailableQuantity(client, stockItemId);

      const originMovement = await client.query(
        `INSERT INTO warehouse_stock_movements (
          warehouse_id,
          stock_item_id,
          item_name,
          direction,
          quantity,
          reference_transfer_id,
          notes,
          created_by
        ) VALUES ($1, $2, $3, 'out', $4, $5, $6, $7)
        RETURNING id, warehouse_id, stock_item_id, item_name, direction, quantity`,
        [
          originWarehouseId,
          stockItemId,
          entry.item_name,
          quantity,
          transferId,
          `Transfer to warehouse ${destinationWarehouseId}${transfer.notes ? `: ${transfer.notes}` : ''}`,
          req.user.id,
        ],
      );

      const destinationMovement = await client.query(
        `INSERT INTO warehouse_stock_movements (
          warehouse_id,
          stock_item_id,
          item_name,
          direction,
          quantity,
          reference_transfer_id,
          notes,
          created_by
        ) VALUES ($1, $2, $3, 'in', $4, $5, $6, $7)
        RETURNING id, warehouse_id, stock_item_id, item_name, direction, quantity`,
        [
          destinationWarehouseId,
          stockItemId,
          entry.item_name,
          quantity,
          transferId,
          `Transfer from warehouse ${originWarehouseId}${transfer.notes ? `: ${transfer.notes}` : ''}`,
          req.user.id,
        ],
      );

      movements.push({
        stock_item_id: stockItemId,
        item_name: entry.item_name,
        quantity,
        origin_movement_id: originMovement.rows[0].id,
        destination_movement_id: destinationMovement.rows[0].id,
      });
    }

    const updatedTransferRes = await client.query(
      `UPDATE warehouse_transfer_requests
          SET status = 'Approved',
              approved_by = $1,
              approved_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING id, origin_warehouse_id, destination_warehouse_id, status, approved_by, approved_at`,
      [req.user.id, transferId],
    );

    await client.query('COMMIT');

    res.status(200).json({
      message: 'Warehouse transfer approved and executed',
      transfer: updatedTransferRes.rows[0],
      movements,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to approve warehouse transfer:', error.message);
    next(createHttpError(500, 'Failed to approve warehouse transfer'));
  } finally {
    client.release();
  }
};

const rejectTransferRequest = async (req, res, next) => {
  if (!requireWarehouseManager(req, next)) return;

  const transferId = Number(req.params.transferId);
  if (!Number.isInteger(transferId)) {
    return next(createHttpError(400, 'A valid transfer ID is required'));
  }

  const { reason } = req.body || {};

  await ensureWarehouseTransferTables();

  try {
    const result = await pool.query(
      `UPDATE warehouse_transfer_requests
          SET status = 'Rejected',
              rejected_by = $1,
              rejected_at = CURRENT_TIMESTAMP,
              rejection_reason = $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $3 AND status = 'Pending'
        RETURNING id, origin_warehouse_id, destination_warehouse_id, status, rejected_by, rejected_at, rejection_reason`,
      [req.user.id, reason ?? null, transferId],
    );

    if (result.rowCount === 0) {
      return next(createHttpError(400, 'Only pending transfer requests can be rejected'));
    }

    res.status(200).json({
      message: 'Warehouse transfer rejected',
      transfer: result.rows[0],
    });
  } catch (error) {
    console.error('❌ Failed to reject warehouse transfer:', error.message);
    next(createHttpError(500, 'Failed to reject warehouse transfer'));
  }
};

const getTransferRequest = async (req, res, next) => {
  if (!req.user?.hasPermission('warehouse.view-supply')) {
    return next(createHttpError(403, 'You do not have permission to view warehouse transfers'));
  }

  const transferId = Number(req.params.transferId);
  if (!Number.isInteger(transferId)) {
    return next(createHttpError(400, 'A valid transfer ID is required'));
  }

  await ensureWarehouseTransferTables();

  try {
    const transferRes = await pool.query(
      `SELECT id, origin_warehouse_id, destination_warehouse_id, status, notes, requested_by,
              approved_by, approved_at, rejected_by, rejected_at, rejection_reason, created_at, updated_at
         FROM warehouse_transfer_requests
        WHERE id = $1`,
      [transferId],
    );

    if (transferRes.rowCount === 0) {
      return next(createHttpError(404, 'Transfer request not found'));
    }

    const itemsRes = await pool.query(
      `SELECT id, stock_item_id, item_name, quantity, notes
         FROM warehouse_transfer_items
        WHERE transfer_id = $1
        ORDER BY id`,
      [transferId],
    );

    res.status(200).json({
      transfer: transferRes.rows[0],
      items: itemsRes.rows,
    });
  } catch (error) {
    console.error('❌ Failed to fetch warehouse transfer:', error.message);
    next(createHttpError(500, 'Failed to fetch warehouse transfer'));
  }
};

module.exports = {
  createTransferRequest,
  approveTransferRequest,
  rejectTransferRequest,
  getTransferRequest,
};