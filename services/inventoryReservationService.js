'use strict';

const pool = require('../config/db');
const withTransaction = require('../utils/withTransaction');
const InventoryError = require('../errors/inventoryError');
const { authorizeInventoryMovement } = require('../policies/inventoryPolicy');
const { postMovement } = require('./inventoryPostingService');

async function authorize(client, input, warehouseId, permission) {
  const warehouse = await client.query('SELECT id,institute_id FROM warehouses WHERE id=$1 AND is_active=true FOR SHARE', [warehouseId]);
  if (!warehouse.rowCount) throw new InventoryError('WAREHOUSE_SCOPE_DENIED', 'Warehouse is unavailable', 403);
  authorizeInventoryMovement(input.actor, { permission }, warehouse.rows[0]);
  return warehouse.rows[0];
}

async function reserve(input, suppliedClient = null) {
  const quantity = Number(input.quantity);
  if (!(quantity > 0) || !input.documentType || input.documentId == null || !input.idempotencyKey) throw new InventoryError('INVALID_RESERVATION', 'Positive quantity, document reference, and idempotency key are required', 400);
  return withTransaction(async (client) => {
    const warehouse = await authorize(client, input, input.warehouseId, 'inventory.reserve');
    if (input.instituteId != null && Number(input.instituteId) !== Number(warehouse.institute_id)) throw new InventoryError('INSTITUTE_SCOPE_DENIED', 'Reservation institute does not match warehouse', 403);
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
    const result = await client.query(`INSERT INTO inventory_reservations (warehouse_id,stock_item_id,document_type,document_id,document_line_id,quantity,consumed_quantity,status,idempotency_key,expires_at,created_by,metadata) VALUES ($1,$2,$3,$4,$5,$6,0,'ACTIVE',$7,$8,$9,$10::jsonb) RETURNING *`, [input.warehouseId,input.inventoryItemId,input.documentType,String(input.documentId),input.documentLineId == null ? null : String(input.documentLineId),quantity,input.idempotencyKey,input.expiresAt || null,input.actor.id,JSON.stringify({})]);
    for (const allocation of allocations) await client.query(`INSERT INTO inventory_reservation_allocations(reservation_id,warehouse_stock_level_id,reserved_quantity) VALUES($1,$2,$3)`, [result.rows[0].id, allocation.warehouseStockLevelId, allocation.quantity]);
    return { idempotent: false, reservation: result.rows[0], allocations };
  }, { client: suppliedClient, pool });
}

async function release(input, suppliedClient = null) {
  return withTransaction(async (client) => {
    const result = await client.query('SELECT * FROM inventory_reservations WHERE id=$1 FOR UPDATE', [input.reservationId]);
    if (!result.rowCount) throw new InventoryError('RESERVATION_NOT_FOUND', 'Reservation not found', 404);
    const reservation = result.rows[0];
    await authorize(client, input, reservation.warehouse_id, 'inventory.reserve');
    if (reservation.status !== 'ACTIVE') return { idempotent: true, reservation };
    const allocations = await client.query(`SELECT * FROM inventory_reservation_allocations WHERE reservation_id=$1 ORDER BY id FOR UPDATE`, [reservation.id]);
    for (const allocation of allocations.rows) {
      const amount = Number(allocation.reserved_quantity)-Number(allocation.consumed_quantity)-Number(allocation.released_quantity);
      if (!amount) continue;
      const balance = await client.query('UPDATE warehouse_stock_levels SET reserved_quantity=reserved_quantity-$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND reserved_quantity >= $2 RETURNING id', [allocation.warehouse_stock_level_id, amount]);
      if (!balance.rowCount) throw new InventoryError('RESERVATION_BALANCE_MISMATCH', 'Reserved stock balance is inconsistent', 409);
      await client.query('UPDATE inventory_reservation_allocations SET released_quantity=released_quantity+$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1', [allocation.id, amount]);
    }
    const updated = await client.query(`UPDATE inventory_reservations SET status='RELEASED',released_at=CURRENT_TIMESTAMP,released_by=$2 WHERE id=$1 RETURNING *`, [reservation.id,input.actor.id]);
    return { idempotent: false, reservation: updated.rows[0] };
  }, { client: suppliedClient, pool });
}

async function issue(input, suppliedClient = null) {
  return withTransaction(async (client) => {
    const result = await client.query('SELECT * FROM inventory_reservations WHERE id=$1 FOR UPDATE', [input.reservationId]);
    if (!result.rowCount || result.rows[0].status !== 'ACTIVE') throw new InventoryError('RESERVATION_NOT_ACTIVE', 'An active reservation is required', 409);
    const reservation = result.rows[0]; const remainingReservation = Number(reservation.quantity)-Number(reservation.consumed_quantity);
    // Issuing is intentionally conjunctive: inventory.reserve proves authority over
    // the reservation document, while inventory.issue authorizes the physical debit.
    const warehouse = await authorize(client, input, reservation.warehouse_id, 'inventory.reserve');
    await authorize(client, input, reservation.warehouse_id, 'inventory.issue');
    const quantity = Number(input.quantity ?? remainingReservation);
    if (!(quantity > 0) || quantity > remainingReservation) throw new InventoryError('RESERVATION_EXCEEDED', 'Issue quantity exceeds remaining reserved quantity', 409);
    const rows = await client.query(`SELECT * FROM inventory_reservation_allocations WHERE reservation_id=$1 ORDER BY id FOR UPDATE`, [reservation.id]);
    let left = quantity; const consumed = [];
    for (const allocation of rows.rows) {
      const available = Number(allocation.reserved_quantity)-Number(allocation.consumed_quantity)-Number(allocation.released_quantity);
      const amount = Math.min(left, available); if (!amount) continue;
      consumed.push({ allocation, amount }); left -= amount; if (!left) break;
    }
    if (left) throw new InventoryError('RESERVATION_ALLOCATION_MISMATCH', 'Reservation allocations cannot satisfy issue', 409);
    for (const { allocation, amount } of consumed) {
      const balance = await client.query('UPDATE warehouse_stock_levels SET reserved_quantity=reserved_quantity-$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND reserved_quantity >= $2 RETURNING id', [allocation.warehouse_stock_level_id, amount]);
      if (!balance.rowCount) throw new InventoryError('RESERVATION_BALANCE_MISMATCH', 'Reserved stock balance is inconsistent', 409);
      await client.query('UPDATE inventory_reservation_allocations SET consumed_quantity=consumed_quantity+$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1', [allocation.id, amount]);
    }
    const posted = await postMovement({ ...input, movementType:'ISSUE', inventoryItemId:reservation.stock_item_id, instituteId:warehouse.institute_id, warehouseId:reservation.warehouse_id, quantity, stockStatus:'AVAILABLE', sourceDocumentType:reservation.document_type, sourceDocumentId:reservation.document_id, sourceDocumentLineId:reservation.document_line_id, idempotencyKey:input.idempotencyKey || `reservation:${reservation.id}:issue:${Number(reservation.consumed_quantity)}`, allocationOverrides:consumed.map(({allocation,amount})=>({warehouseStockLevelId:allocation.warehouse_stock_level_id,quantity:amount})), metadata:{ reservationId:reservation.id } }, client);
    const totalConsumed = Number(reservation.consumed_quantity)+quantity; const complete = totalConsumed === Number(reservation.quantity);
    await client.query(`UPDATE inventory_reservations SET consumed_quantity=$2,status=CASE WHEN $3 THEN 'CONSUMED' ELSE 'ACTIVE' END,consumed_at=CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END,consumed_by=CASE WHEN $3 THEN $4 ELSE NULL END WHERE id=$1`, [reservation.id,totalConsumed,complete,input.actor.id]);
    return posted;
  }, { client: suppliedClient, pool });
}

module.exports = { reserve, release, issue };