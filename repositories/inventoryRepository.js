class InventoryRepository {
  constructor(client) { this.client = client; }
  async loadWarehouses(ids) {
    if (!ids.length) return [];
    const result = await this.client.query('SELECT id, institute_id FROM warehouses WHERE id = ANY($1::int[]) AND is_active = true FOR SHARE', [ids]);
    return result.rows;
  }
  async findDuplicate({ genericItemId, approvedProductId, inventoryUomId, instituteIds }) {
    const result = await this.client.query(`SELECT si.id FROM stock_items si
      WHERE si.generic_item_id = $1 AND si.approved_product_id IS NOT DISTINCT FROM $2
        AND si.inventory_uom_id = $3 AND EXISTS (
          SELECT 1 FROM warehouse_stock_levels wsl JOIN warehouses w ON w.id = wsl.warehouse_id
          WHERE wsl.stock_item_id = si.id AND w.institute_id = ANY($4::int[])
        ) LIMIT 1 FOR UPDATE`, [genericItemId, approvedProductId, inventoryUomId, instituteIds]);
    return result.rows[0] || null;
  }
  async insertStockItem(identity, actorId) {
    const result = await this.client.query(`INSERT INTO stock_items
      (name, description, unit, category, sub_category, brand, created_by, category_id,
       manufacturer_id, generic_item_id, approved_product_id, inventory_uom_id,
       mapping_status, identity_source, legacy_identity_snapshot)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'normalized',$14) RETURNING *`, [
      identity.name, identity.description, identity.uomName, identity.categoryName,
      identity.subcategoryName, identity.manufacturerName, actorId, identity.categoryId,
      identity.manufacturerId, identity.genericItemId, identity.approvedProductId,
      identity.inventoryUomId, identity.approvedProductId ? 'mapped_product' : 'mapped_generic', identity.snapshot,
    ]);
    return result.rows[0];
  }
  async setupWarehouse(stockItem, configuration, genericItemId, actorId) {
    await this.client.query(`INSERT INTO warehouse_stock_levels
      (warehouse_id, stock_item_id, generic_item_id, item_name, quantity, updated_by)
      VALUES ($1,$2,$3,$4,0,$5) ON CONFLICT (warehouse_id, stock_item_id)
      DO UPDATE SET generic_item_id=EXCLUDED.generic_item_id, item_name=EXCLUDED.item_name, updated_by=EXCLUDED.updated_by`,
    [configuration.warehouse_id, stockItem.id, genericItemId, stockItem.name, actorId]);
  }
  async upsertPolicy(stockItemId, configuration, actorId) {
    if (!configuration.replenishment_policy) return;
    const p = configuration.replenishment_policy;
    await this.client.query(`INSERT INTO warehouse_replenishment_policies
      (warehouse_id, stock_item_id, reorder_point, safety_stock, lead_time_days, review_period_days, lot_size, is_active, updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (warehouse_id, stock_item_id) DO UPDATE SET
      reorder_point=EXCLUDED.reorder_point,safety_stock=EXCLUDED.safety_stock,lead_time_days=EXCLUDED.lead_time_days,
      review_period_days=EXCLUDED.review_period_days,lot_size=EXCLUDED.lot_size,is_active=EXCLUDED.is_active,updated_by=EXCLUDED.updated_by`,
    [configuration.warehouse_id, stockItemId, p.reorder_point ?? 0, p.safety_stock ?? 0,
      p.lead_time_days ?? 0, p.review_period_days ?? 0, p.lot_size ?? 0, p.is_active ?? true, actorId]);
  }
  async audit(stockItemId, action, actorId, values, reason = null) {
    await this.client.query(`INSERT INTO item_master_audit_events
      (entity_type,entity_id,action,actor_id,reason,new_values) VALUES ('stock_item',$1,$2,$3,$4,$5)`,
    [stockItemId, action, actorId, reason, values]);
  }

  async validateWarehouse(warehouseId, instituteId) {
    const result = await this.client.query(
      'SELECT id, institute_id, name FROM warehouses WHERE id = $1 AND institute_id = $2 AND is_active = true',
      [warehouseId, instituteId],
    );
    return result.rows[0] || null;
  }

  async validateInventoryItem(inventoryItemId) {
    const result = await this.client.query(
      `SELECT si.id, si.name, si.unit, si.inventory_uom_id, si.generic_item_id,
              iu.name AS inventory_uom
         FROM stock_items si
         LEFT JOIN item_uom iu ON iu.id = si.inventory_uom_id
        WHERE si.id = $1`,
      [inventoryItemId],
    );
    return result.rows[0] || null;
  }

  async findMovementByIdempotencyKey(idempotencyKey) {
    const result = await this.client.query(
      'SELECT * FROM inventory_transactions WHERE idempotency_key = $1',
      [idempotencyKey],
    );
    return result.rows[0] || null;
  }

  async lockPostingKeys(command) {
    // Transaction-scoped advisory locks also serialize a missing balance row and concurrent retries.
    await this.client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0)),
              pg_advisory_xact_lock(hashtextextended($2, 0))`,
      [command.idempotencyKey, `${command.instituteId}:${command.warehouseId}:${command.inventoryItemId}:${command.stockStatus}:${command.batchNumber || ''}:${command.lotNumber || ''}:${command.serialNumber || ''}`],
    );
  }

  // Canonical balance identity: warehouse, inventory item, status, batch, lot, serial, and expiry.
  async lockExactInventoryBalance({ warehouseId, inventoryItemId, stockStatus, batchNumber, lotNumber, serialNumber, expiryDate }) {
    const result = await this.client.query(
      `SELECT * FROM warehouse_stock_levels
        WHERE warehouse_id = $1 AND stock_item_id = $2
          AND stock_status = $3
          AND batch_number IS NOT DISTINCT FROM $4::text
          AND lot_number IS NOT DISTINCT FROM $5::text
          AND serial_number IS NOT DISTINCT FROM $6::text
          AND expiry_date IS NOT DISTINCT FROM $7::date
        ORDER BY id FOR UPDATE`,
      [warehouseId, inventoryItemId, stockStatus, batchNumber ?? null, lotNumber ?? null,
        serialNumber ?? null, expiryDate ?? null],
    );
    return result.rows;
  }

  async lockEligibleOutboundBalances({ warehouseId, inventoryItemId, stockStatus, batchNumber, lotNumber, serialNumber, expiryDate }) {
    const result = await this.client.query(
      `SELECT * FROM warehouse_stock_levels
        WHERE warehouse_id = $1 AND stock_item_id = $2 AND stock_status = $3
          AND ($4::text IS NULL OR batch_number IS NOT DISTINCT FROM $4::text)
          AND ($5::text IS NULL OR lot_number IS NOT DISTINCT FROM $5::text)
          AND ($6::text IS NULL OR serial_number IS NOT DISTINCT FROM $6::text)
          AND ($7::date IS NULL OR expiry_date IS NOT DISTINCT FROM $7::date)
          AND quantity > 0
        ORDER BY expiry_date ASC NULLS LAST, id FOR UPDATE`,
      [warehouseId, inventoryItemId, stockStatus, batchNumber ?? null, lotNumber ?? null,
        serialNumber ?? null, expiryDate ?? null],
    );
    return result.rows;
  }

  async createInventoryBalance(command, itemName) {
    const result = await this.client.query(
      `INSERT INTO warehouse_stock_levels
        (warehouse_id, stock_item_id, item_name, quantity, updated_by, stock_status,
         batch_number, lot_number, serial_number, expiry_date)
       VALUES ($1,$2,$3,0,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [command.warehouseId, command.inventoryItemId, itemName, command.actor.id, command.stockStatus,
        command.batchNumber || null, command.lotNumber || null, command.serialNumber || null, command.expiryDate || null],
    );
    return result.rows[0];
  }

  async updateInventoryBalance(balanceId, delta, actorId) {
    const result = await this.client.query(
      `UPDATE warehouse_stock_levels SET quantity = quantity + $2, updated_by = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND quantity + $2 >= 0 RETURNING *`,
      [balanceId, delta, actorId],
    );
    return result.rows[0] || null;
  }

  async insertInventoryMovement(command, signedQuantity, item) {
    const result = await this.client.query(
      `INSERT INTO inventory_transactions
        (transaction_type, movement_type, source_location, destination_location, warehouse_id,
         department_id, stock_item_id, quantity, base_uom, source_quantity, source_uom,
         conversion_factor, batch_number, lot_number, serial_number, expiry_date, stock_status,
         source_document_type, source_document_id, source_document_line_id, reference_document,
         notes, created_by, institute_id, idempotency_key, correlation_id, metadata,
         reversal_of_movement_id, command_fingerprint)
       VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$17,$20,$21,$22,$23,$24,$25::jsonb,$26,$27)
       RETURNING *`,
      [command.movementType, `warehouse:${command.warehouseId}`, command.destinationLocation || null,
        command.warehouseId, command.departmentId || null, command.inventoryItemId, signedQuantity,
        command.baseUom || item.inventory_uom || item.unit, command.sourceQuantity || command.quantity,
        command.sourceUom || command.baseUom || item.inventory_uom || item.unit, command.conversionFactor || 1,
        command.batchNumber || null, command.lotNumber || null, command.serialNumber || null,
        command.expiryDate || null, command.stockStatus, command.sourceDocumentType,
        String(command.sourceDocumentId), command.sourceDocumentLineId == null ? null : String(command.sourceDocumentLineId),
        command.reason || null, command.actor.id, command.instituteId, command.idempotencyKey,
        command.correlationId || null, JSON.stringify(command.metadata || {}), command.reversalOfMovementId || null,
        command.commandFingerprint],
    );
    return result.rows[0];
  }

  async lockMovementForReversal(movementId) {
    const result = await this.client.query('SELECT * FROM inventory_transactions WHERE id = $1 FOR UPDATE', [movementId]);
    return result.rows[0] || null;
  }

  async markMovementReversed(originalId, reversalId) {
    await this.client.query(
      'UPDATE inventory_transactions SET reversed_by_movement_id = $2 WHERE id = $1 AND reversed_by_movement_id IS NULL',
      [originalId, reversalId],
    );
  }
}
module.exports = InventoryRepository;