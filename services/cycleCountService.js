'use strict';
const pool = require('../config/db');
const withTransaction = require('../utils/withTransaction');
const InventoryError = require('../errors/inventoryError');
const { hasPermission } = require('../policies/inventoryPolicy');
const { adjustInventory } = require('./inventoryAdjustmentService');

async function postCount(input, suppliedClient = null) {
  if (!hasPermission(input?.actor, 'inventory.cycle-count')) throw new InventoryError('INVENTORY_PERMISSION_DENIED', 'Permission required: inventory.cycle-count', 403);
  return withTransaction(async (client) => {
    const row = await client.query(`SELECT cc.*,ccl.id line_id,ccl.stock_item_id,ccl.system_quantity,ccl.counted_quantity,ccl.warehouse_stock_level_id FROM inventory_cycle_counts cc JOIN inventory_cycle_count_lines ccl ON ccl.cycle_count_id=cc.id WHERE cc.id=$1 AND ccl.id=$2 FOR UPDATE OF cc,ccl`, [input.cycleCountId,input.lineId]);
    if (!row.rowCount) throw new InventoryError('CYCLE_COUNT_NOT_FOUND','Cycle count line not found',404);
    const count = row.rows[0];
    if (count.status !== 'APPROVED' || !count.reviewed_by) throw new InventoryError('CYCLE_COUNT_REVIEW_REQUIRED','An approved, reviewed count is required',409);
    const linePosted = await client.query('SELECT posted_at FROM inventory_cycle_count_lines WHERE id=$1', [count.line_id]);
    if (linePosted.rows[0].posted_at) throw new InventoryError('CYCLE_COUNT_LINE_ALREADY_POSTED','Cycle count line was already posted',409);
    const variance = Number(count.counted_quantity)-Number(count.system_quantity);
    let movement = null;
    if (variance) movement = await adjustInventory({ type:variance > 0?'POSITIVE':'NEGATIVE',inventoryItemId:count.stock_item_id,instituteId:input.instituteId,warehouseId:count.warehouse_id,quantity:Math.abs(variance),reason:input.reason || count.notes || 'Approved cycle count variance',actor:input.actor,idempotencyKey:`cycle-count:${count.id}:line:${count.line_id}`,sourceDocumentType:'cycle_count',sourceDocumentId:count.id,sourceDocumentLineId:count.line_id,stockStatus:'AVAILABLE' },client);
    await client.query(`UPDATE inventory_cycle_count_lines SET variance=$2,posted_movement_id=$3,posted_at=CURRENT_TIMESTAMP WHERE id=$1`,[count.line_id,variance,movement?.movement?.id || null]);
    const remaining = await client.query(`SELECT count(*)::integer AS count FROM inventory_cycle_count_lines WHERE cycle_count_id=$1 AND posted_at IS NULL`, [count.id]);
    const completed = Number(remaining.rows[0].count) === 0;
    if (completed) await client.query(`UPDATE inventory_cycle_counts SET status='POSTED',posted_at=CURRENT_TIMESTAMP,posted_by=$2 WHERE id=$1`,[count.id,input.actor.id]);
    return { variance, movement, completed };
  }, { client:suppliedClient,pool });
}
module.exports={ postCount };