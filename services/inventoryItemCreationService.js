const createHttpError = require('../utils/httpError');
const ItemMasterRepository = require('../repositories/itemMasterRepository');
const InventoryRepository = require('../repositories/inventoryRepository');
const { validateAddToInventoryPayload } = require('../validators/stockItemIdentityValidator');
const { DatabaseCapabilityService } = require('./databaseCapabilityService');

function codedError(status, code, message, details = {}) {
  const error = createHttpError(status, message); error.code = code; Object.assign(error, details); return error;
}
function isActive(record) { return record?.is_active === true && (!record.lifecycle_status || record.lifecycle_status === 'active'); }
function deriveIdentity(generic, product, uom) {
  const manufacturerName = product?.manufacturer_name || null;
  const name = [generic.generic_name, manufacturerName, product?.manufacturer_part_number].filter(Boolean).join(' — ');
  return {
    name, description: generic.canonical_description, categoryId: generic.category_id,
    categoryName: generic.category_name, subcategoryName: generic.subcategory,
    manufacturerId: product?.manufacturer_id || null, manufacturerName,
    genericItemId: generic.id, approvedProductId: product?.id || null,
    inventoryUomId: uom.id, uomName: uom.uom_name || uom.uom_code,
    snapshot: { generic_item_id: generic.id, approved_product_id: product?.id || null,
      category_id: generic.category_id, manufacturer_id: product?.manufacturer_id || null,
      inventory_uom_id: uom.id, display_name: name },
  };
}
class InventoryItemCreationService {
  constructor(db, capabilityService = new DatabaseCapabilityService(db)) { this.db = db; this.capabilities = capabilityService; }
  async create(payload, actorId) {
    const input = validateAddToInventoryPayload(payload);
    await this.capabilities.require('itemMasterFoundationAvailable');
    await this.capabilities.require('stockItemIdentityAvailable');
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const master = new ItemMasterRepository(client); const inventory = new InventoryRepository(client);
      const generic = await master.findGeneric(input.generic_item_id);
      if (!generic) throw codedError(404, 'generic_item_not_found', 'Generic Item was not found');
      if (!isActive(generic)) throw codedError(409, 'generic_item_inactive', 'Generic Item is inactive');
      if (!generic.category_id || !generic.category_name) throw codedError(409, 'mapping_target_invalid', 'Generic Item has no active controlled category');
      const uom = await master.findUom(input.inventory_uom_id);
      if (!uom) throw codedError(400, 'mapping_target_invalid', 'Inventory UOM is invalid or inactive');
      let product = null;
      if (input.approved_product_id) {
        product = await master.findProduct(input.approved_product_id);
        if (!product || product.approval_status !== 'approved' || !isActive(product)) throw codedError(400, 'approved_product_invalid', 'Approved Product is invalid or inactive');
        if (product.generic_item_id !== generic.id) throw codedError(400, 'approved_product_wrong_generic', 'Approved Product belongs to another Generic Item');
        if (!product.manufacturer_id || !product.manufacturer_name) throw codedError(409, 'mapping_target_invalid', 'Approved Product has no controlled manufacturer');
      }
      const warehouseIds = input.warehouse_configurations.map((row) => row.warehouse_id);
      const warehouses = await inventory.loadWarehouses(warehouseIds);
      if (warehouses.length !== warehouseIds.length) throw codedError(400, 'mapping_target_invalid', 'A warehouse is invalid or inactive');
      const instituteIds = [...new Set(warehouses.map((row) => row.institute_id))];
      if (instituteIds.some((id) => id == null)) throw codedError(409, 'mapping_target_invalid', 'Warehouse inventory scope is unavailable');
      if (instituteIds.length) {
        const duplicate = await inventory.findDuplicate({ genericItemId: generic.id, approvedProductId: product?.id || null, inventoryUomId: uom.id, instituteIds });
        if (duplicate) throw codedError(409, 'inventory_item_exists', 'Equivalent inventory item already exists', { existing_stock_item_id: duplicate.id, match_reason: 'same normalized inventory identity' });
      }
      const identity = deriveIdentity(generic, product, uom);
      const stockItem = await inventory.insertStockItem(identity, actorId);
      for (const configuration of input.warehouse_configurations) {
        await inventory.setupWarehouse(stockItem, configuration, generic.id, actorId);
      }
      await inventory.audit(stockItem.id, 'added_from_master', actorId, identity.snapshot);
      await client.query('COMMIT'); return stockItem;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
}
module.exports = { InventoryItemCreationService, deriveIdentity, codedError };