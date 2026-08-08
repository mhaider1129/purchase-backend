'use strict';

const { userHasPermission } = require('../utils/permissionService');
const InventoryError = require('../errors/inventoryError');

function hasPermission(actor, code) {
  const direct = (permission) => userHasPermission(actor, permission) || actor?.hasPermission?.(permission) === true;
  return direct(code) || (code === 'inventory.issue' && direct('warehouse.manage-supply')) ||
    (code === 'inventory.receive' && direct('procure-to-pay.receipts.manage'));
}

function authorizeInventoryMovement(actor, movement, warehouse) {
  if (!actor || actor.is_active === false || actor.active === false) throw new InventoryError('ACTOR_INACTIVE', 'An active actor is required', 403);
  if (!hasPermission(actor, movement.permission)) throw new InventoryError('INVENTORY_PERMISSION_DENIED', `Permission required: ${movement.permission}`, 403);
  const actorInstituteId = Number(actor.institute_id ?? actor.instituteId);
  if (actorInstituteId && actorInstituteId !== Number(warehouse.institute_id) && !hasPermission(actor, 'inventory.cross-institute')) {
    throw new InventoryError('INSTITUTE_SCOPE_DENIED', 'Cross-institute inventory access is denied', 403);
  }
  const actorWarehouseId = Number(actor.warehouse_id ?? actor.warehouseId);
  if (actorWarehouseId && actorWarehouseId !== Number(warehouse.id) && !hasPermission(actor, 'inventory.cross-warehouse')) {
    throw new InventoryError('WAREHOUSE_SCOPE_DENIED', 'Cross-warehouse inventory access is denied', 403);
  }
}

module.exports = { authorizeInventoryMovement, hasPermission };