'use strict';
const pool = require('../config/db');
const { getPermissionsForUserId, userHasPermission } = require('../utils/permissionService');
const error = (statusCode, message, code = 'PLANNING_SCOPE_DENIED') => Object.assign(new Error(message), { statusCode, code });
const missing = () => error(404, 'Planning record or reference not found');
const positive = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= 2147483647;
const id = value => { if (!positive(value)) throw error(400, 'A positive record ID is required', 'PLANNING_INVALID_ID'); return Number(value); };
const has = (actor, permission) => userHasPermission(actor, permission);
const can = (actor, action = 'read') => action === 'read'
  ? ['planning.view', 'planning.manage', 'replenishment.manage'].some(p => has(actor, p))
  : has(actor, action === 'replenish' ? 'replenishment.manage' : 'planning.manage');
function requireCapability(actor, action) {
  if (!actor?.id) throw error(401, 'Authentication required', 'PLANNING_AUTH_REQUIRED');
  if (!can(actor, action)) throw error(403, 'Planning permission required', 'PLANNING_PERMISSION_DENIED');
}
const ids = values => Array.isArray(values) ? [...new Set(values.filter(positive).map(Number))] : [];
function createPlanningAuthorization(database = pool, lookup = getPermissionsForUserId) {
  async function actor(input, action = 'read', db = database) {
    if (!positive(input?.id)) throw error(401, 'Authentication required', 'PLANNING_AUTH_REQUIRED');
    const user = (await db.query('SELECT id,role,department_id,warehouse_id,institute_id,is_active FROM users WHERE id=$1' + (db !== database ? ' FOR SHARE' : ''), [input.id])).rows[0];
    if (!user?.is_active || !positive(user.institute_id)) throw error(403, 'An active institute account is required');
    const grants = await lookup(user.id, db);
    if (!Array.isArray(grants?.permissions) || grants.found === false || (grants.dataScopes != null && (typeof grants.dataScopes !== 'object' || Array.isArray(grants.dataScopes))))
      throw error(503, 'Planning authorization unavailable');
    const result = { ...user, permissions: grants.permissions, data_scopes: grants.dataScopes || {} };
    result.departmentIds = ids([user.department_id, ...ids(result.data_scopes.department_ids)]);
    result.warehouseIds = ids([user.warehouse_id, ...ids(result.data_scopes.warehouse_ids)]);
    requireCapability(result, action);
    return result;
  }
  const inInstitute = (a, instituteId) => {
    if (!positive(instituteId) || Number(a.institute_id) !== Number(instituteId)) throw missing();
  };
  const departmentAllowed = (a, departmentId) => has(a, 'planning.cross-department') || a.departmentIds.includes(Number(departmentId));
  const warehouseAllowed = (a, w) => has(a, 'planning.cross-warehouse') || a.warehouseIds.includes(Number(w.id)) || (positive(a.department_id) && Number(w.department_id) === Number(a.department_id));
  async function department(a, value, db = database) {
    requireCapability(a,'read');
    const d = (await db.query('SELECT id,institute_id FROM departments WHERE id=$1 FOR SHARE', [id(value)])).rows[0];
    if (!d) throw missing(); inInstitute(a, d.institute_id);
    if (!departmentAllowed(a, d.id)) throw missing();
    return d;
  }
  async function warehouse(a, value, db = database, write = false) {
    requireCapability(a,'read');
    const w = (await db.query('SELECT w.*,d.institute_id AS department_institute_id FROM warehouses w LEFT JOIN departments d ON d.id=w.department_id WHERE w.id=$1 FOR SHARE OF w', [id(value)])).rows[0];
    if (!w) throw missing(); inInstitute(a, w.institute_id);
    if (w.department_id != null) inInstitute(a, w.department_institute_id);
    if (!warehouseAllowed(a, w) || (write && w.is_active !== true)) throw missing();
    return w;
  }
  async function plan(a, value, action = 'read', db = database) {
    requireCapability(a, action);
    const p = (await db.query('SELECT p.*,d.institute_id FROM procurement_plans p JOIN departments d ON d.id=p.department_id WHERE p.id=$1 ' + (action === 'read' ? 'FOR SHARE OF p' : 'FOR UPDATE OF p'), [id(value)])).rows[0];
    if (!p) throw missing(); inInstitute(a, p.institute_id);
    if (!departmentAllowed(a, p.department_id)) throw missing();
    return p;
  }
  async function planItem(a, planId, value, db = database) {
    await plan(a,planId,'read',db);
    const item = (await db.query('SELECT * FROM procurement_plan_items WHERE id=$1 AND plan_id=$2 FOR SHARE', [id(value), id(planId)])).rows[0];
    if (!item) throw missing(); return item;
  }
  async function stock(a, value, context = {}, db = database) {
    requireCapability(a,'read');
    if (context.warehouseId) await warehouse(a,context.warehouseId,db);
    if (context.departmentId) await department(a,context.departmentId,db);
    const item = (await db.query('SELECT * FROM stock_items WHERE id=$1 FOR SHARE', [id(value)])).rows[0];
    if (!item) throw missing();
    if (item.institute_id != null) { inInstitute(a, item.institute_id); return item; }
    // Shared legacy identities need a concrete scoped stocking association.
    let owned;
    if (context.warehouseId) owned = await db.query('SELECT id FROM warehouse_stock_levels WHERE warehouse_id=$1 AND stock_item_id=$2 LIMIT 1', [context.warehouseId, item.id]);
    else if (context.departmentId) owned = await db.query('SELECT id FROM department_stock_levels WHERE department_id=$1 AND stock_item_id=$2 LIMIT 1', [context.departmentId, item.id]);
    if (!owned?.rows.length) throw missing(); return item;
  }
  async function requestedItem(a, value, departmentId, db = database) {
    requireCapability(a,'read');
    const row = (await db.query('SELECT ri.*,r.institute_id,r.department_id,r.warehouse_id AS request_warehouse_id,r.id AS parent_request_id FROM requested_items ri JOIN requests r ON r.id=ri.request_id JOIN departments d ON d.id=r.department_id AND d.institute_id=r.institute_id WHERE ri.id=$1 FOR SHARE OF ri,r', [id(value)])).rows[0];
    if (!row) throw missing(); inInstitute(a, row.institute_id);
    if (!departmentAllowed(a, row.department_id) || Number(row.department_id) !== Number(departmentId)) throw missing();
    if (row.request_warehouse_id != null) await warehouse(a,row.request_warehouse_id,db);
    return row;
  }
  async function movement(a, type, value, departmentId, db = database) {
    requireCapability(a,'read');
    const sql = type === 'warehouse'
      ? 'SELECT m.*,m.to_department_id AS department_id FROM warehouse_stock_movements m WHERE m.id=$1 FOR SHARE OF m'
      : 'SELECT m.*,l.department_id,l.stock_item_id FROM department_stock_movements m JOIN department_stock_levels l ON l.id=m.department_stock_level_id WHERE m.id=$1 FOR SHARE OF m,l';
    const m = (await db.query(sql, [id(value)])).rows[0];
    if (!m || Number(m.department_id) !== Number(departmentId)) throw missing();
    await department(a, m.department_id, db);
    const warehouseId = type === 'warehouse' ? m.warehouse_id : m.source_warehouse_id;
    if (warehouseId) await warehouse(a, warehouseId, db);
    if (m.direction !== 'out') throw error(400, 'Only outbound movements can be linked', 'PLANNING_INVALID_MOVEMENT');
    return m;
  }
  async function validateLinks(a, p, db = database) {
    const items = (await db.query('SELECT * FROM procurement_plan_items WHERE plan_id=$1 ORDER BY id', [p.id])).rows;
    for (const item of items) if (item.stock_item_id) await stock(a, item.stock_item_id, { departmentId: p.department_id }, db);
    const requests = (await db.query('SELECT l.* FROM procurement_plan_item_requests l JOIN procurement_plan_items i ON i.id=l.plan_item_id WHERE i.plan_id=$1', [p.id])).rows;
    for (const link of requests) {
      const ri = await requestedItem(a, link.requested_item_id, p.department_id, db);
      if (Number(ri.request_id) !== Number(link.request_id)) throw missing();
    }
    const consumptions = (await db.query('SELECT l.* FROM procurement_plan_item_consumptions l JOIN procurement_plan_items i ON i.id=l.plan_item_id WHERE i.plan_id=$1', [p.id])).rows;
    for (const link of consumptions) {
      if (Boolean(link.warehouse_stock_movement_id) === Boolean(link.department_stock_movement_id)) throw missing();
      if (link.warehouse_stock_movement_id) await movement(a, 'warehouse', link.warehouse_stock_movement_id, p.department_id, db);
      else if (link.department_stock_movement_id) await movement(a, 'department', link.department_stock_movement_id, p.department_id, db);
      else throw missing();
    }
    return items;
  }
  return { actor, department, warehouse, plan, planItem, stock, requestedItem, movement, validateLinks, inInstitute, departmentAllowed, warehouseAllowed };
}
module.exports = { createPlanningAuthorization, requireCapability, has, can, id, missing, error };
