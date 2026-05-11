const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const ensureWarehouseInventoryTables = require('../utils/ensureWarehouseInventoryTables');
const ensureWarehouseAssignments = require('../utils/ensureWarehouseAssignments');
const recalculateAvailableQuantity = require('../utils/recalculateAvailableQuantity');

const parseQuantity = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return NaN;
  return parsed;
};

const normalizeNullableText = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
};

const normalizeNullableDate = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const issueWarehouseStock = async (req, res, next) => {
  const {
    stock_item_id: rawStockItemId,
    quantity: rawQuantity,
    department_id: rawDepartmentId,
    section_id: rawSectionId,
    warehouse_id,
    notes,
    items: rawItems,
  } = req.body || {};

  if (!req.user?.hasPermission('warehouse.manage-supply')) {
    return next(createHttpError(403, 'You do not have permission to issue warehouse stock'));
  }

  const departmentId = Number(rawDepartmentId);
  if (!Number.isInteger(departmentId)) {
    return next(createHttpError(400, 'A valid department_id is required'));
  }

  const hasSectionId = rawSectionId !== undefined && rawSectionId !== null && rawSectionId !== '';
  const sectionId = hasSectionId ? Number(rawSectionId) : null;
  if (hasSectionId && !Number.isInteger(sectionId)) {
    return next(createHttpError(400, 'A valid section_id is required'));
  }

  const rawIssueItems = Array.isArray(rawItems) && rawItems.length > 0
    ? rawItems
    : [
        {
          stock_item_id: rawStockItemId,
          quantity: rawQuantity,
          notes,
        },
      ];

    const normalizedItems = [];
  for (let i = 0; i < rawIssueItems.length; i += 1) {
    const entry = rawIssueItems[i] || {};
    const stockItemId = Number(entry.stock_item_id ?? entry.stockItemId);
    const quantity = parseQuantity(entry.quantity);

    if (!Number.isInteger(stockItemId) || !Number.isFinite(quantity) || quantity <= 0) {
      return next(
        createHttpError(400, `A valid stock_item_id and positive quantity are required for item #${i + 1}`),
      );
    }

    normalizedItems.push({
      stockItemId,
      quantity,
      notes: entry.notes ?? notes ?? null,
      pickingStrategy: String(entry.picking_strategy || req.body?.picking_strategy || 'fefo').toLowerCase(),
    });
  }

  if (normalizedItems.length === 0) {
    return next(createHttpError(400, 'At least one stock item is required to issue inventory'));
  }

  await ensureWarehouseAssignments();

  const fallbackWarehouseId = req.user?.warehouse_id;
  const providedWarehouseId =
    warehouse_id === undefined || warehouse_id === null || warehouse_id === ''
      ? null
      : Number(warehouse_id);
  const warehouseId = providedWarehouseId ?? fallbackWarehouseId;

  if (!Number.isInteger(warehouseId)) {
    return next(createHttpError(400, 'A valid warehouse must be specified'));
  }

  await ensureWarehouseInventoryTables();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const departmentRes = await client.query(
      'SELECT id FROM departments WHERE id = $1',
      [departmentId],
    );

    if (departmentRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Department not found'));
    }

    if (sectionId !== null) {
      const sectionRes = await client.query(
        'SELECT id FROM sections WHERE id = $1 AND department_id = $2',
        [sectionId, departmentId],
      );

      if (sectionRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return next(createHttpError(400, 'Section does not belong to the selected department'));
      }
    }

    const balances = [];

    for (let i = 0; i < normalizedItems.length; i += 1) {
      const { stockItemId, quantity, notes: itemNotes } = normalizedItems[i];

      const stockItemRes = await client.query(
        'SELECT id, name FROM stock_items WHERE id = $1',
        [stockItemId],
      );

      if (stockItemRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return next(createHttpError(404, `Stock item not found for entry #${i + 1}`));
      }

      const itemName = stockItemRes.rows[0].name;

      const strategy = ['fefo', 'fifo'].includes(normalizedItems[i].pickingStrategy)
        ? normalizedItems[i].pickingStrategy
        : 'fefo';

      const balanceRes = await client.query(
        `SELECT id, batch_id, lot_number, expiry_date, serial_number, quantity
           FROM warehouse_stock_levels
          WHERE warehouse_id = $1 AND stock_item_id = $2 AND quantity > 0
          ORDER BY
            CASE
              WHEN $3 = 'fefo' THEN COALESCE(expiry_date, DATE '9999-12-31')
              ELSE DATE '9999-12-31'
            END ASC,
            COALESCE(updated_at, CURRENT_TIMESTAMP) ASC,
            id ASC
          FOR UPDATE`,
        [warehouseId, stockItemId, strategy],
      );

      if (balanceRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return next(
          createHttpError(
            400,
            `Warehouse inventory for ${itemName} is not initialized. Please add stock before issuing items.`,
          ),
        );
      }

      const currentQty = balanceRes.rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
      if (currentQty < quantity) {
        await client.query('ROLLBACK');
        return next(
          createHttpError(
            400,
            `Insufficient stock for ${itemName}. Available: ${currentQty}, requested: ${quantity}`,
          ),
        );
      }
      let remainingToIssue = quantity;
      for (const batchRow of balanceRes.rows) {
        if (remainingToIssue <= 0) break;
        const availableInRow = Number(batchRow.quantity) || 0;
        if (availableInRow <= 0) continue;
        const consumed = Math.min(remainingToIssue, availableInRow);

        await client.query(
          `UPDATE warehouse_stock_levels
              SET quantity = quantity - $2,
                  updated_at = CURRENT_TIMESTAMP,
                  updated_by = $3
            WHERE id = $1`,
          [batchRow.id, consumed, req.user.id],
        );

        const departmentLevelRes = await client.query(
          `SELECT id, quantity
             FROM department_stock_levels
            WHERE department_id = $1
              AND section_id IS NOT DISTINCT FROM $2
              AND stock_item_id = $3
              AND warehouse_batch_id IS NOT DISTINCT FROM $4
              AND lot_number IS NOT DISTINCT FROM $5
              AND expiry_date IS NOT DISTINCT FROM $6
              AND serial_number IS NOT DISTINCT FROM $7
            FOR UPDATE`,
          [departmentId, sectionId, stockItemId, batchRow.batch_id, batchRow.lot_number, batchRow.expiry_date, batchRow.serial_number],
        );

        let departmentStockLevelId;
        if (departmentLevelRes.rowCount > 0) {
          departmentStockLevelId = departmentLevelRes.rows[0].id;
          await client.query(
            `UPDATE department_stock_levels
                SET quantity = quantity + $2,
                    updated_by = $3,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = $1`,
            [departmentStockLevelId, consumed, req.user.id],
          );
        } else {
          const insertDeptLevelRes = await client.query(
            `INSERT INTO department_stock_levels (
              department_id,
              section_id,
              warehouse_batch_id,
              stock_item_id,
              lot_number,
              expiry_date,
              serial_number,
              quantity,
              updated_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id`,
            [departmentId, sectionId, batchRow.batch_id, stockItemId, batchRow.lot_number, batchRow.expiry_date, batchRow.serial_number, consumed, req.user.id],
          );
          departmentStockLevelId = insertDeptLevelRes.rows[0].id;
        }

        await client.query(
          `INSERT INTO department_stock_movements (
            department_stock_level_id,
            direction,
            quantity,
            source_warehouse_id,
            source_batch_id,
            lot_number,
            expiry_date,
            serial_number,
            notes,
            created_by
          ) VALUES ($1, 'in', $2, $3, $4, $5, $6, $7, $8, $9)`,
          [departmentStockLevelId, consumed, warehouseId, batchRow.batch_id, batchRow.lot_number, batchRow.expiry_date, batchRow.serial_number, itemNotes || null, req.user.id],
        );

        await client.query(
          `INSERT INTO warehouse_stock_movements (
              warehouse_id,
              stock_item_id,
              batch_id,
              item_name,
              lot_number,
              expiry_date,
              serial_number,
              direction,
              quantity,
              to_department_id,
              to_section_id,
              created_by,
              notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'out', $8, $9, $10, $11, $12)`,
          [warehouseId, stockItemId, batchRow.batch_id, itemName, batchRow.lot_number, batchRow.expiry_date, batchRow.serial_number, consumed, departmentId, sectionId, req.user.id, itemNotes || null],
        );

        remainingToIssue -= consumed;
      }

      const updatedBalanceRes = await client.query(
        `SELECT id, warehouse_id, stock_item_id, item_name, quantity, updated_at
           FROM warehouse_stock_levels
          WHERE warehouse_id = $1 AND stock_item_id = $2
          ORDER BY quantity DESC, id ASC`,
        [warehouseId, stockItemId],
      );

      await recalculateAvailableQuantity(client, stockItemId);

      balances.push(updatedBalanceRes.rows[0]);
    }

    await client.query('COMMIT');

    res.status(200).json({
      message: 'Stock issued to department',
      balances,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to issue warehouse stock:', err.message);
    next(createHttpError(500, 'Failed to issue warehouse stock'));
  } finally {
    client.release();
  }
};

const addWarehouseStock = async (req, res, next) => {
  const {
    stock_item_id: rawStockItemId,
    quantity: rawQuantity,
    notes,
    warehouse_id,
    batch_id: rawBatchId,
    lot_number: rawLotNumber,
    expiry_date: rawExpiryDate,
    serial_number: rawSerialNumber,
  } = req.body || {};

  if (!req.user?.hasPermission('warehouse.manage-supply')) {
    return next(createHttpError(403, 'You do not have permission to manage warehouse stock'));
  }

  const stockItemId = Number(rawStockItemId);
  if (!Number.isInteger(stockItemId)) {
    return next(createHttpError(400, 'A valid stock_item_id is required'));
  }

  const quantity = parseQuantity(rawQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return next(createHttpError(400, 'Quantity must be a positive number'));
  }

  const batchId = rawBatchId === undefined || rawBatchId === null || rawBatchId === '' ? null : Number(rawBatchId);
  if (batchId !== null && !Number.isInteger(batchId)) {
    return next(createHttpError(400, 'batch_id must be an integer when provided'));
  }
  const lotNumber = normalizeNullableText(rawLotNumber);
  const serialNumber = normalizeNullableText(rawSerialNumber);
  const expiryDate = normalizeNullableDate(rawExpiryDate);

  await ensureWarehouseAssignments();

  const fallbackWarehouseId = req.user?.warehouse_id;
  const providedWarehouseId =
    warehouse_id === undefined || warehouse_id === null || warehouse_id === ''
      ? null
      : Number(warehouse_id);
  const warehouseId = providedWarehouseId ?? fallbackWarehouseId;

  if (!Number.isInteger(warehouseId)) {
    return next(createHttpError(400, 'A valid warehouse must be specified'));
  }

  await ensureWarehouseInventoryTables();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const stockItemRes = await client.query(
      'SELECT id, name FROM stock_items WHERE id = $1',
      [stockItemId],
    );

    if (stockItemRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Stock item not found'));
    }

    const itemName = stockItemRes.rows[0].name;

    const existingLevelRes = await client.query(
      `SELECT id
         FROM warehouse_stock_levels
        WHERE warehouse_id = $1
          AND stock_item_id = $2
          AND batch_id IS NOT DISTINCT FROM $3
          AND lot_number IS NOT DISTINCT FROM $4
          AND expiry_date IS NOT DISTINCT FROM $5
          AND serial_number IS NOT DISTINCT FROM $6
        FOR UPDATE`,
      [warehouseId, stockItemId, batchId, lotNumber, expiryDate, serialNumber],
    );

    let balanceRes;
    if (existingLevelRes.rowCount > 0) {
      balanceRes = await client.query(
        `UPDATE warehouse_stock_levels
            SET quantity = quantity + $2,
                updated_by = $3,
                updated_at = CURRENT_TIMESTAMP,
                item_name = $4
          WHERE id = $1
          RETURNING id, warehouse_id, stock_item_id, batch_id, item_name, lot_number, expiry_date, serial_number, quantity, updated_at`,
        [existingLevelRes.rows[0].id, quantity, req.user.id, itemName],
      );
    } else {
      balanceRes = await client.query(
        `INSERT INTO warehouse_stock_levels (
          warehouse_id,
          stock_item_id,
          batch_id,
          item_name,
          lot_number,
          expiry_date,
          serial_number,
          quantity,
          updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, warehouse_id, stock_item_id, batch_id, item_name, lot_number, expiry_date, serial_number, quantity, updated_at`,
        [warehouseId, stockItemId, batchId, itemName, lotNumber, expiryDate, serialNumber, quantity, req.user.id],
      );
    }

    await recalculateAvailableQuantity(client, stockItemId);

    await client.query(
      `INSERT INTO warehouse_stock_movements (
        warehouse_id, stock_item_id, batch_id, item_name, lot_number, expiry_date, serial_number, direction, quantity, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'in', $8, $9, $10)`,
      [warehouseId, stockItemId, batchId, itemName, lotNumber, expiryDate, serialNumber, quantity, notes || null, req.user.id],
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Stock quantity added to warehouse',
      balance: balanceRes.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to add warehouse stock:', err.message);
    next(createHttpError(500, 'Failed to add warehouse stock'));
  } finally {
    client.release();
  }
};

const discardWarehouseStock = async (req, res, next) => {
  const {
    stock_item_id: rawStockItemId,
    quantity: rawQuantity,
    reason,
    notes,
    warehouse_id,
    lot_number: rawLotNumber,
    expiry_date: rawExpiryDate,
    serial_number: rawSerialNumber,
    batch_id: rawBatchId,
  } = req.body || {};

  if (!req.user?.hasPermission('warehouse.manage-supply')) {
    return next(createHttpError(403, 'You do not have permission to adjust warehouse stock'));
  }

  const stockItemId = Number(rawStockItemId);
  if (!Number.isInteger(stockItemId)) {
    return next(createHttpError(400, 'A valid stock_item_id is required'));
  }

  const quantity = parseQuantity(rawQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return next(createHttpError(400, 'Quantity must be a positive number'));
  }

  const batchId = rawBatchId === undefined || rawBatchId === null || rawBatchId === '' ? null : Number(rawBatchId);
  if (batchId !== null && !Number.isInteger(batchId)) {
    return next(createHttpError(400, 'batch_id must be an integer when provided'));
  }
  const lotNumber = normalizeNullableText(rawLotNumber);
  const serialNumber = normalizeNullableText(rawSerialNumber);
  const expiryDate = normalizeNullableDate(rawExpiryDate);

  const normalizedReason = String(reason || '').trim().toLowerCase();
  const allowedReasons = ['expired', 'damaged', 'other'];
  if (!normalizedReason || !allowedReasons.includes(normalizedReason)) {
    return next(createHttpError(400, 'A reason of expired, damaged, or other is required'));
  }

  await ensureWarehouseAssignments();

  const fallbackWarehouseId = req.user?.warehouse_id;
  const providedWarehouseId =
    warehouse_id === undefined || warehouse_id === null || warehouse_id === '' ? null : Number(warehouse_id);
  const warehouseId = providedWarehouseId ?? fallbackWarehouseId;

  if (!Number.isInteger(warehouseId)) {
    return next(createHttpError(400, 'A valid warehouse must be specified'));
  }

  await ensureWarehouseInventoryTables();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const stockItemRes = await client.query('SELECT id, name FROM stock_items WHERE id = $1', [stockItemId]);

    if (stockItemRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Stock item not found'));
    }

    const itemName = stockItemRes.rows[0].name;

    const balanceRes = await client.query(
      `SELECT id, batch_id, lot_number, expiry_date, serial_number, quantity
         FROM warehouse_stock_levels
        WHERE warehouse_id = $1 AND stock_item_id = $2
          AND batch_id IS NOT DISTINCT FROM $3
          AND lot_number IS NOT DISTINCT FROM $4
          AND expiry_date IS NOT DISTINCT FROM $5
          AND serial_number IS NOT DISTINCT FROM $6
        FOR UPDATE`,
      [warehouseId, stockItemId, batchId, lotNumber, expiryDate, serialNumber],
    );

    if (balanceRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(
        createHttpError(
          400,
          `Warehouse inventory for ${itemName} is not initialized. Please add stock before adjusting quantities.`,
        ),
      );
    }

    const currentQty = Number(balanceRes.rows[0].quantity) || 0;
    if (currentQty < quantity) {
      await client.query('ROLLBACK');
      return next(
        createHttpError(
          400,
          `Insufficient stock for ${itemName}. Available: ${currentQty}, requested: ${quantity}`,
        ),
      );
    }

    const updatedBalanceRes = await client.query(
      `UPDATE warehouse_stock_levels
          SET quantity = quantity - $2,
              updated_at = CURRENT_TIMESTAMP,
              updated_by = $3
        WHERE id = $1
        RETURNING id, warehouse_id, stock_item_id, item_name, quantity, updated_at`,
      [balanceRes.rows[0].id, quantity, req.user.id],
    );

    await recalculateAvailableQuantity(client, stockItemId);

    const destructionNotes = notes?.trim()
      ? `Destroyed (${normalizedReason}): ${notes.trim()}`
      : `Destroyed (${normalizedReason})`;

    const movementRes = await client.query(
      `INSERT INTO warehouse_stock_movements (
          warehouse_id,
          stock_item_id,
          batch_id,
          item_name,
          lot_number,
          expiry_date,
          serial_number,
          direction,
          quantity,
          notes,
          created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'out', $8, $9, $10)
        RETURNING id, warehouse_id, stock_item_id, item_name, lot_number, expiry_date, serial_number, direction, quantity, notes, created_at`,
      [warehouseId, stockItemId, batchId, itemName, lotNumber, expiryDate, serialNumber, quantity, destructionNotes, req.user.id],
    );

    await client.query('COMMIT');

    res.status(200).json({
      message: 'Stock removal recorded',
      balance: updatedBalanceRes.rows[0],
      movement: movementRes.rows[0],
      reason: normalizedReason,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to discard warehouse stock:', err.message);
    next(createHttpError(500, 'Failed to discard warehouse stock'));
  } finally {
    client.release();
  }
};

const getWarehouseItems = async (req, res, next) => {
  const warehouseId = Number(req.params.warehouseId);

  if (!Number.isInteger(warehouseId)) {
    return next(createHttpError(400, 'A valid warehouse ID is required'));
  }

  await ensureWarehouseAssignments();
  await ensureWarehouseInventoryTables();

  try {
    const { rows } = await pool.query(
      `SELECT stock_item_id, batch_id, item_name, lot_number, expiry_date, serial_number, quantity
         FROM warehouse_stock_levels
        WHERE warehouse_id = $1
        ORDER BY item_name, COALESCE(expiry_date, DATE '9999-12-31'), lot_number NULLS LAST`,
      [warehouseId],
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to fetch warehouse items:', err.message);
    next(createHttpError(500, 'Failed to fetch warehouse items'));
  }
};

const getWeeklyDepartmentStockingReport = async (req, res, next) => {
  if (!req.user?.hasPermission('warehouse.view-supply')) {
    return next(createHttpError(403, 'You do not have permission to view warehouse reports'));
  }

  await ensureWarehouseInventoryTables();

  const now = new Date();
  const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  try {
    const { rows } = await pool.query(
      `SELECT
        d.id AS department_id,
        d.name AS department_name,
        COALESCE(
          json_agg(
            json_build_object(
              'stock_item_id', m.stock_item_id,
              'item_name', m.item_name,
              'total_quantity', m.total_quantity
            ) ORDER BY m.item_name
          ) FILTER (WHERE m.stock_item_id IS NOT NULL),
          '[]'::json
        ) AS items
      FROM (
        SELECT
          to_department_id,
          stock_item_id,
          item_name,
          SUM(quantity) AS total_quantity
        FROM warehouse_stock_movements
        WHERE direction = 'out'
          AND to_department_id IS NOT NULL
          AND created_at >= $1
        GROUP BY to_department_id, stock_item_id, item_name
      ) m
      JOIN departments d ON d.id = m.to_department_id
      GROUP BY d.id, d.name
      ORDER BY d.name`,
      [windowStart],
    );

    res.json({
      generated_at: now.toISOString(),
      window_start: windowStart.toISOString(),
      window_end: now.toISOString(),
      departments: rows,
    });
  } catch (err) {
    console.error('❌ Failed to generate weekly stocking report:', err.message);
    next(createHttpError(500, 'Failed to generate weekly stocking report'));
  }
};

module.exports = {
  addWarehouseStock,
  discardWarehouseStock,
  getWeeklyDepartmentStockingReport,
  issueWarehouseStock,
  getWarehouseItems,
};