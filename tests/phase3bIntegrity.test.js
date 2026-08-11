'use strict';
const fs = require('fs');
const path = require('path');
const { validateInventoryMovement } = require('../validators/inventoryMovementValidator');
const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
describe('Phase 3B inventory integrity', () => {
  test('transfer receipts lock durable per-dispatch-allocation progress', () => {
    const service=read('services/warehouseTransferService.js'); const sql=read('sql/manual/005_inventory_operations.sql');
    expect(service).toContain('inventory_transfer_allocation_links'); expect(service).toContain('ORDER BY a.allocation_sequence,a.id FOR UPDATE OF l');
    expect(service).toContain('Number(allocation.dispatched_quantity)-Number(allocation.received_quantity)');
    expect(sql).toContain('UNIQUE(dispatch_allocation_id)'); expect(sql).toContain('received_quantity<=dispatched_quantity');
  });
  test('repeated transfer receipts use durable operation identity and cannot restart original allocations', () => {
    const service=read('services/warehouseTransferService.js'); expect(service).toContain('inventory_transfer_receipt_operations');
    expect(service).toContain('UPDATE inventory_transfer_allocation_links SET received_quantity=received_quantity+$2');
    expect(service).not.toContain('Math.min(left,Math.abs(Number(allocation.quantity)))');
  });
  test('reservation schema preserves original, consumed, released, and remaining arithmetic', () => {
    const sql=read('sql/manual/005_inventory_operations.sql'); expect(sql).toContain('ALTER TABLE inventory_reservations ADD COLUMN IF NOT EXISTS consumed_quantity');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS inventory_reservation_allocations'); expect(sql).toContain('CHECK(consumed_quantity+released_quantity<=reserved_quantity)'); expect(sql).toContain('consumed_quantity<=quantity');
  });
  test('partial issue consumes locked allocation rows and remains active until complete', () => {
    const service=read('services/inventoryReservationService.js'); expect(service).toContain('ORDER BY id FOR UPDATE');
    expect(service).toContain('quantity)-Number(allocation.consumed_quantity)-Number(allocation.released_quantity)');
    expect(service).toContain("status=CASE WHEN $3 THEN 'CONSUMED' ELSE 'ACTIVE' END"); expect(service).toContain('allocationOverrides:consumed.map');
  });
  test('release returns only unused remainder and guards balance consistency', () => {
    const service=read('services/inventoryReservationService.js'); expect(service).toContain('SET released_quantity=released_quantity+$2'); expect(service).toContain('RESERVATION_BALANCE_MISMATCH');
  });
  test('cycle-count header posts only after all applicable lines post', () => {
    const service=read('services/cycleCountService.js'); expect(service).toContain('cycle_count_id=$1 AND posted_at IS NULL');
    expect(service).toContain('if (completed) await client.query'); expect(service).toContain('CYCLE_COUNT_LINE_ALREADY_POSTED'); expect(service).toContain('FOR UPDATE OF cc,ccl');
  });
  test('status transfers derive business permission and use controlled posting', () => {
    const status=read('services/inventoryStatusTransferService.js'); const posting=read('services/inventoryPostingService.js');
    expect(status).toContain("'inventory.quarantine'"); expect(status).toContain("'inventory.release-quarantine'"); expect(status).toContain("'inventory.recall'");
    expect(status).toContain('postStatusTransferMovement'); expect(posting).toContain('statusTransferOperation !== operation');
  });
  test('generic external validation cannot spoof internal status authorization', () => {
    expect(()=>validateInventoryMovement({movementType:'QUARANTINE',coordinator:'inventoryStatusTransferService'})).toThrow(expect.objectContaining({code:'UNSUPPORTED_MOVEMENT'}));
    expect(()=>validateInventoryMovement({movementType:'NEGATIVE_ADJUSTMENT',coordinator:'inventoryStatusTransferService'})).toThrow(expect.objectContaining({code:'INVALID_INVENTORY_ITEM'}));
  });
});