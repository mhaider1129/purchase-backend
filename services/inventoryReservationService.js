'use strict';

const pool = require('../config/db');
const withTransaction = require('../utils/withTransaction');
const InventoryError = require('../errors/inventoryError');
const { hasPermission } = require('../policies/inventoryPolicy');
const { postMovement } = require('./inventoryPostingService');

async function reserve(input, suppliedClient = null) {
  if (!hasPermission(input?.actor, 'inventory.reserve')) throw new InventoryError('INVENTORY_PERMISSION_DENIED', 'Permission required: inventory.reserve', 403);
  const quantity = Number(input.quantity);
  if (!(quantity > 0) || !input.documentType || input.documentId == null || !input.idempotencyKey) throw new InventoryError('INVALID_RESERVATION', 'Positive quantity, document reference, and idempotency key are required', 400);
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`reservation:${input.idempotencyKey}`]);
    const duplicate = await client.query('SELECT * FROM inventory_reservations WHERE idempotency_key=$1', [input.idempotencyKey]);
    if (duplicate.rowCount) return { idempotent: true, reservation: duplicate.rows[0] };
    const balances = await client.query(`SELECT * FROM warehouse_stock_levels WHERE warehouse_id=$1 AND stock_item_id=$2 AND stock_status='AVAILABLE' AND quantity-reserved_quantity>0 ORDER BY expiry_date ASC NULLS LAST,id FOR UPDATE`, [input.warehouseId, input.inventoryItemId]);
    const available = balances.rows.reduce((sum, row) => sum + Number(row.quantity) - Number(row.reserved_quantity || 0), 0);
    if (available < quantity) throw new InventoryError('INSUFFICIENT_AVAILABLE_STOCK', `Available stock ${available} is less than requested reservation ${quantity}`, 409);
    let remaining = quantity;
    const allocations = [];
    for (const balance of balances.rows) {
      const amount = Math.min(remaining, Number(balance.quantity) - Number(balance.reserved_quantity || 0));
      if (!amount) continue;
      await client.query('UPDATE warehouse_stock_levels SET reserved_quantity=reserved_quantity+$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1', [balance.id, amount]);
      allocations.push({ warehouseStockLevelId: balance.id, quantity: amount }); remaining -= amount;
      if (!remaining) break;
    }
    const result = await client.query(`INSERT INTO inventory_reservations (warehouse_id,stock_item_id,document_type,document_id,document_line_id,quantity,status,idempotency_key,expires_at,created_by,metadata) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7,$8,$9,$10::jsonb) RETURNING *`, [input.warehouseId,input.inventoryItemId,input.documentType,String(input.documentId),input.documentLineId == null ? null : String(input.documentLineId),quantity,input.idempotencyKey,input.expiresAt || null,input.actor.id,JSON.stringify({ allocations })]);
    return { idempotent: false, reservation: result.rows[0], allocations };
  }, { client: suppliedClient, pool });
}

async function release(input, suppliedClient = null) {
  return withTransaction(async (client) => {
    const result = await client.query('SELECT * FROM inventory_reservations WHERE id=$1 FOR UPDATE', [input.reservationId]);
    if (!result.rowCount) throw new InventoryError('RESERVATION_NOT_FOUND', 'Reservation not found', 404);
    const reservation = result.rows[0];
    if (reservation.status !== 'ACTIVE') return { idempotent: true, reservation };
    for (const allocation of reservation.metadata?.allocations || []) await client.query('UPDATE warehouse_stock_levels SET reserved_quantity=reserved_quantity-$2 WHERE id=$1 AND reserved_quantity >= $2', [allocation.warehouseStockLevelId, allocation.quantity]);
    const updated = await client.query(`UPDATE inventory_reservations SET status='RELEASED',released_at=CURRENT_TIMESTAMP,released_by=$2 WHERE id=$1 RETURNING *`, [reservation.id,input.actor.id]);
    return { idempotent: false, reservation: updated.rows[0] };
  }, { client: suppliedClient, pool });
}

async function issue(input, suppliedClient = null) {
  return withTransaction(async (client) => {
    const result = await client.query('SELECT * FROM inventory_reservations WHERE id=$1 FOR UPDATE', [input.reservationId]);
    if (!result.rowCount || result.rows[0].status !== 'ACTIVE') throw new InventoryError('RESERVATION_NOT_ACTIVE', 'An active reservation is required', 409);
    const reservation = result.rows[0]; const quantity = Number(input.quantity || reservation.quantity);
    if (quantity > Number(reservation.quantity)) throw new InventoryError('RESERVATION_EXCEEDED', 'Issue quantity exceeds reserved quantity', 409);
    for (const allocation of reservation.metadata?.allocations || []) await client.query('UPDATE warehouse_stock_levels SET reserved_quantity=reserved_quantity-$2 WHERE id=$1 AND reserved_quantity >= $2', [allocation.warehouseStockLevelId, allocation.quantity]);
    const posted = await postMovement({ ...input, movementType:'ISSUE', inventoryItemId:reservation.stock_item_id, warehouseId:reservation.warehouse_id, quantity, stockStatus:'AVAILABLE', sourceDocumentType:reservation.document_type, sourceDocumentId:reservation.document_id, sourceDocumentLineId:reservation.document_line_id, idempotencyKey:input.idempotencyKey || `reservation:${reservation.id}:issue`, metadata:{ reservationId:reservation.id } }, client);
    await client.query(`UPDATE inventory_reservations SET status='CONSUMED',consumed_at=CURRENT_TIMESTAMP,consumed_by=$2 WHERE id=$1`, [reservation.id,input.actor.id]);
    return posted;
  }, { client: suppliedClient, pool });
}

module.exports = { reserve, release, issue };