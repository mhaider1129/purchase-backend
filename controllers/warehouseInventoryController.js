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

const insertInventoryTransaction = async (client, payload) => {
  const {
    transactionType,
    sourceLocation = null,
    destinationLocation = null,
    warehouseId = null,
    departmentId = null,
    sectionId = null,
    batchId = null,
    stockItemId,
    quantity,
    unitCost = null,
    referenceDocument = null,
    referenceRequestId = null,
    referenceTransferId = null,
    warehouseStockMovementId = null,
    departmentStockMovementId = null,
    notes = null,
    createdBy = null,
  } = payload;

  await client.query(
    `INSERT INTO inventory_transactions (
      transaction_type, source_location, destination_location, warehouse_id, department_id, section_id,
      batch_id, stock_item_id, quantity, unit_cost, reference_document, reference_request_id, reference_transfer_id,
      warehouse_stock_movement_id, department_stock_movement_id, notes, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [transactionType, sourceLocation, destinationLocation, warehouseId, departmentId, sectionId, batchId, stockItemId, quantity, unitCost, referenceDocument, referenceRequestId, referenceTransferId, warehouseStockMovementId, departmentStockMovementId, notes, createdBy],
  );
};

const issueWarehouseStock = async (req, res, next) => {
  const { stock_item_id, quantity, department_id, section_id, warehouse_id, notes, items } = req.body || {};
  if (!req.user?.hasPermission('warehouse.manage-supply')) return next(createHttpError(403, 'You do not have permission to issue warehouse stock'));
  const departmentId = Number(department_id);
  const sectionId = section_id == null || section_id === '' ? null : Number(section_id);
  const warehouseId = Number(warehouse_id || req.user?.warehouse_id);
  if (!Number.isInteger(departmentId)) return next(createHttpError(400, 'A valid department_id is required'));
  if (sectionId !== null && !Number.isInteger(sectionId)) return next(createHttpError(400, 'A valid section_id is required'));
  if (!Number.isInteger(warehouseId)) return next(createHttpError(400, 'A valid warehouse must be specified'));
  const inputItems = Array.isArray(items) && items.length ? items : [{ stock_item_id, quantity, notes }];
  const normalized = inputItems.map((line, index) => {
    const itemId = Number(line?.stock_item_id ?? line?.stockItemId);
    const itemQuantity = parseQuantity(line?.quantity);
    if (!Number.isInteger(itemId) || !(itemQuantity > 0)) throw createHttpError(400, `A valid stock_item_id and positive quantity are required for item #${index + 1}`);
    return { itemId, quantity: itemQuantity, notes: line?.notes ?? notes ?? null };
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const scope = await client.query('SELECT id, institute_id FROM warehouses WHERE id = $1 AND is_active = true', [warehouseId]);
    if (!scope.rowCount) throw createHttpError(404, 'Warehouse not found');
    const department = await client.query('SELECT id FROM departments WHERE id = $1', [departmentId]);
    if (!department.rowCount) throw createHttpError(404, 'Department not found');
    if (sectionId !== null) {
      const section = await client.query('SELECT id FROM sections WHERE id = $1 AND department_id = $2', [sectionId, departmentId]);
      if (!section.rowCount) throw createHttpError(400, 'Section does not belong to the selected department');
    }
    const { postMovements } = require('../services/inventoryPostingService');
    const requestKey = req.get?.('Idempotency-Key') || req.body?.idempotency_key || `warehouse-issue:${req.user.id}:${Date.now()}`;
    const commands = normalized.map((line, index) => ({
      movementType: 'ISSUE', inventoryItemId: line.itemId, instituteId: scope.rows[0].institute_id,
      warehouseId, quantity: line.quantity, stockStatus: 'AVAILABLE', sourceDocumentType: 'warehouse_issue',
      sourceDocumentId: req.body?.reference_request_id || requestKey, sourceDocumentLineId: index + 1,
      departmentId, destinationLocation: sectionId ? `department:${departmentId}:section:${sectionId}` : `department:${departmentId}`,
      reason: line.notes, actor: req.user, idempotencyKey: `${requestKey}:line:${index + 1}`,
      correlationId: req.correlationId || requestKey, metadata: { departmentId, sectionId },
    }));
    const results = await postMovements(commands, client);
    await client.query('COMMIT');
    return res.status(200).json({ message: 'Stock issued to department', balances: results.map((result) => result.balances?.[0]).filter(Boolean) });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.statusCode) return next(error);
    console.error('❌ Failed to issue warehouse stock:', error.message);
    return next(createHttpError(500, 'Failed to issue warehouse stock'));
  } finally { client.release(); }
};

const inventoryAdjustmentService = require('../services/inventoryAdjustmentService');

const resolveAdjustmentContext = async (warehouseId) => {
  const { rows } = await pool.query('SELECT id, institute_id FROM warehouses WHERE id = $1 AND is_active = true', [warehouseId]);
  if (!rows[0]) throw createHttpError(404, 'Warehouse not found');
  return rows[0];
};

const addWarehouseStock = async (req, res, next) => {
  try {
    if (!req.user?.hasPermission('inventory.adjust') && !req.user?.hasPermission('inventory.opening-balance')) return next(createHttpError(403, 'Permission required: inventory.adjust'));
    const stockItemId = Number(req.body?.stock_item_id); const quantity = parseQuantity(req.body?.quantity);
    const warehouseId = Number(req.body?.warehouse_id || req.user?.warehouse_id);
    const reason = String(req.body?.reason || req.body?.notes || '').trim();
    if (!Number.isInteger(stockItemId) || !(quantity > 0) || !Number.isInteger(warehouseId)) return next(createHttpError(400, 'Valid warehouse, stock item, and positive quantity are required'));
    if (!reason) return next(createHttpError(400, 'A reason is required'));
    const warehouse = await resolveAdjustmentContext(warehouseId);
    const key = req.get?.('Idempotency-Key') || req.body?.idempotency_key;
    if (!key) return next(createHttpError(400, 'Idempotency-Key is required'));
    const result = await inventoryAdjustmentService.positive({ inventoryItemId: stockItemId, instituteId: warehouse.institute_id, warehouseId, quantity,
      reason, actor: req.user, idempotencyKey: key, sourceDocumentType: req.body?.source_document_type || 'warehouse_stock_add',
      sourceDocumentId: req.body?.source_document_id || key, batchNumber: req.body?.batch_number || null, lotNumber: normalizeNullableText(req.body?.lot_number),
      serialNumber: normalizeNullableText(req.body?.serial_number), expiryDate: normalizeNullableDate(req.body?.expiry_date), stockStatus: req.body?.stock_status || 'AVAILABLE' });
    return res.status(result.idempotent ? 200 : 201).json({ message: 'Stock adjustment posted', ...result });
  } catch (error) { return next(error.statusCode ? error : createHttpError(500, 'Failed to add warehouse stock')); }
};

const discardWarehouseStock = async (req, res, next) => {
  try {
    if (!req.user?.hasPermission('inventory.adjust')) return next(createHttpError(403, 'Permission required: inventory.adjust'));
    const stockItemId = Number(req.body?.stock_item_id); const quantity = parseQuantity(req.body?.quantity);
    const warehouseId = Number(req.body?.warehouse_id || req.user?.warehouse_id); const reason = String(req.body?.reason || '').trim();
    if (!Number.isInteger(stockItemId) || !(quantity > 0) || !Number.isInteger(warehouseId)) return next(createHttpError(400, 'Valid warehouse, stock item, and positive quantity are required'));
    if (!reason) return next(createHttpError(400, 'A reason is required'));
    const warehouse = await resolveAdjustmentContext(warehouseId); const key = req.get?.('Idempotency-Key') || req.body?.idempotency_key;
    if (!key) return next(createHttpError(400, 'Idempotency-Key is required'));
    const result = await inventoryAdjustmentService.negative({ inventoryItemId: stockItemId, instituteId: warehouse.institute_id, warehouseId, quantity,
      reason, actor:req.user,idempotencyKey:key,sourceDocumentType:'warehouse_stock_discard',sourceDocumentId:req.body?.source_document_id || key,
      batchNumber:req.body?.batch_number || null,lotNumber:normalizeNullableText(req.body?.lot_number),serialNumber:normalizeNullableText(req.body?.serial_number),expiryDate:normalizeNullableDate(req.body?.expiry_date),stockStatus:'AVAILABLE',metadata:{discardCategory:reason,notes:req.body?.notes || null} });
    return res.status(200).json({message:'Stock removal posted',...result});
  } catch(error){return next(error.statusCode ? error : createHttpError(500,'Failed to discard warehouse stock'));}
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
      `SELECT
        wsl.stock_item_id,
        wsl.batch_id,
        wsl.item_name,
        wsl.lot_number,
        wsl.expiry_date,
        wsl.serial_number,
        wsl.quantity,
        si.category,
        si.sub_category
       FROM warehouse_stock_levels wsl
       LEFT JOIN stock_items si ON si.id = wsl.stock_item_id
      WHERE wsl.warehouse_id = $1
      ORDER BY wsl.item_name, COALESCE(wsl.expiry_date, DATE '9999-12-31'), wsl.lot_number NULLS LAST`,
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

const getInventoryTransactions = async (req, res, next) => {
  if (!req.user?.hasPermission('warehouse.view-supply')) {
    return next(createHttpError(403, 'You do not have permission to view inventory transactions'));
  }
  await ensureWarehouseInventoryTables();
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const { rows } = await pool.query(
      `SELECT it.*, si.name AS stock_item_name
       FROM inventory_transactions it
       LEFT JOIN stock_items si ON si.id = it.stock_item_id
       ORDER BY it.created_at DESC
       LIMIT $1`,
      [limit],
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to fetch inventory transactions:', err.message);
    next(createHttpError(500, 'Failed to fetch inventory transactions'));
  }
};

module.exports = {
  addWarehouseStock,
  discardWarehouseStock,
  getWeeklyDepartmentStockingReport,
  issueWarehouseStock,
  getWarehouseItems,
  getInventoryTransactions,
};