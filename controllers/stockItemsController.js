const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const ensureWarehouseAssignments = require('../utils/ensureWarehouseAssignments');
const ensureWarehouseInventoryTables = require('../utils/ensureWarehouseInventoryTables');
const recalculateAvailableQuantity = require('../utils/recalculateAvailableQuantity');

const getStockItems = async (req, res, next) => {
  try {
    await ensureWarehouseInventoryTables();

    const result = await pool.query(
      `SELECT
         si.id,
         si.name,
         si.brand,
         si.unit,
         COALESCE(SUM(wsl.quantity), si.available_quantity, 0) AS available_quantity,
         si.category,
         si.sub_category
       FROM stock_items si
       LEFT JOIN warehouse_stock_levels wsl ON wsl.stock_item_id = si.id
       GROUP BY si.id, si.name, si.brand, si.unit, si.category, si.sub_category
       ORDER BY si.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to fetch stock items:', err);
    next(err);
  }
};

const getUnassignedStockItems = async (req, res, next) => {
  if (!req.user?.hasPermission('warehouse.manage-supply')) {
    return next(createHttpError(403, 'You do not have permission to manage warehouse stock'));
  }

  try {
    await ensureWarehouseInventoryTables();

    const { rows } = await pool.query(
      `SELECT
         si.id,
         si.name,
         si.brand,
         si.unit,
         COALESCE(si.available_quantity, 0) AS available_quantity,
         si.category,
         si.sub_category
       FROM stock_items si
       WHERE COALESCE(si.available_quantity, 0) > 0
         AND NOT EXISTS (
           SELECT 1 FROM warehouse_stock_levels wsl WHERE wsl.stock_item_id = si.id
         )
       ORDER BY si.name`,
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to fetch unassigned stock items:', err);
    next(err);
  }
};

const assignStockItemToWarehouses = async (req, res, next) => {
  try {
    if (!req.user?.hasPermission('inventory.adjust') && !req.user?.hasPermission('inventory.opening-balance')) return next(createHttpError(403,'Permission required: inventory.adjust or inventory.opening-balance'));
    const stockItemId=Number(req.params.stockItemId ?? req.params.id ?? req.body?.stock_item_id);const allocations=Array.isArray(req.body?.allocations)?req.body.allocations:[];
    const reason=String(req.body?.reason || '').trim();const importBatch=req.body?.import_batch || req.body?.source_document_id;const requestKey=req.get?.('Idempotency-Key') || req.body?.idempotency_key;
    if(!Number.isInteger(stockItemId)||!allocations.length) return next(createHttpError(400,'A stock item and allocations are required'));
    if(!reason||!importBatch||!requestKey) return next(createHttpError(400,'Reason, import_batch/source_document_id, and Idempotency-Key are required'));
    const client=await pool.connect();try{await client.query('BEGIN');const { positive }=require('../services/inventoryAdjustmentService');const posted=[];
      for(let index=0;index<allocations.length;index++){const line=allocations[index];const warehouseId=Number(line.warehouse_id);const quantity=Number(line.quantity);if(!Number.isInteger(warehouseId)||!(quantity>0))throw createHttpError(400,`Invalid opening allocation #${index+1}`);const scope=await client.query('SELECT institute_id FROM warehouses WHERE id=$1 AND is_active=true',[warehouseId]);if(!scope.rowCount)throw createHttpError(404,`Warehouse ${warehouseId} not found`);posted.push(await positive({inventoryItemId:stockItemId,instituteId:scope.rows[0].institute_id,warehouseId,quantity,reason,actor:req.user,idempotencyKey:`${requestKey}:warehouse:${warehouseId}:line:${index+1}`,sourceDocumentType:'opening_balance',sourceDocumentId:importBatch,sourceDocumentLineId:index+1,batchNumber:line.batch_number||null,lotNumber:line.lot_number||null,serialNumber:line.serial_number||null,expiryDate:line.expiry_date||null,stockStatus:line.stock_status||'AVAILABLE'},client));}
      await client.query('COMMIT');return res.status(201).json({message:'Opening balances posted through canonical inventory',stock_item_id:stockItemId,allocations:posted});
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }catch(error){return next(error.statusCode?error:createHttpError(500,'Failed to post opening balances'));}
};

module.exports = { getStockItems, getUnassignedStockItems, assignStockItemToWarehouses };