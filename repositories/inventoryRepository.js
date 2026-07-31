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
}
module.exports = InventoryRepository;