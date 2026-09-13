
const EquipmentRepository = require('../repositories/equipmentRepository');
const { writeAuditEvent } = require('./auditService');

const error = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, ...(code && { code }) });
const FIELDS = ['asset_id', 'equipment_code', 'name', 'manufacturer', 'model', 'serial_number', 'department_id', 'lifecycle_status'];
const pick = input => Object.fromEntries(FIELDS.filter(key => Object.prototype.hasOwnProperty.call(input, key)).map(key => [key, input[key] === '' ? null : input[key]]));
const canonicalAssetFields = asset => ({
  name: asset.description,
  manufacturer: asset.manufacturer,
  model: asset.model,
  serial_number: asset.serial_number,
  department_id: asset.responsible_department_id,
});

class EquipmentService {
  constructor(repo = new EquipmentRepository(), audit = writeAuditEvent) { this.repo = repo; this.audit = audit; }
  list(query, ctx) { return this.repo.list(ctx.instituteId, query); }
  availableAssets(query, ctx) { return this.repo.availableAssets(ctx.instituteId, query); }
  async get(id, ctx) { const row = await this.repo.get(id, ctx.instituteId); if (!row) throw error(404, 'Equipment not found'); return row; }
  async save(id, input, ctx) {
    const data = pick(input || {});
    if (data.lifecycle_status && !['ACTIVE', 'INACTIVE', 'OBSOLETE', 'SUPERSEDED'].includes(data.lifecycle_status)) throw error(400, 'Invalid equipment lifecycle status');
    return this.repo.transaction(async repo => {
      const before = id ? await repo.get(id, ctx.instituteId, true) : null;
      if (id && !before) throw error(404, 'Equipment not found');
      const targetAssetId = Object.prototype.hasOwnProperty.call(data, 'asset_id') ? data.asset_id : before?.asset_id;
      if (!id && !targetAssetId) throw error(400, 'Asset is required for new equipment', 'EQUIPMENT_ASSET_REQUIRED');
      if (id && before.asset_id && !targetAssetId) throw error(409, 'Linked equipment cannot be detached from its Asset', 'EQUIPMENT_ASSET_DETACH_FORBIDDEN');
      if (targetAssetId) {
        const asset = await repo.asset(targetAssetId, ctx.instituteId);
        if (!asset) throw error(400, 'Asset not found in institute', 'EQUIPMENT_ASSET_INVALID');
        Object.assign(data, canonicalAssetFields(asset));
      }
      const merged = { ...before, ...data };
      for (const field of ['equipment_code', 'name']) if (!String(merged[field] || '').trim()) throw error(400, `${field} is required`);
      if (!targetAssetId) {
        // Only pre-integration legacy rows may remain unlinked while they are reconciled.
        for (const field of ['manufacturer', 'model']) if (!String(merged[field] || '').trim()) throw error(400, `${field} is required for legacy unlinked equipment`);
        if (merged.department_id && !await repo.department(merged.department_id, ctx.instituteId)) throw error(400, 'Department not found in institute');
      }
      let row;
      try { row = await repo.save(id, ctx.instituteId, data); }
      catch (cause) { if (cause.code === '23505' && cause.constraint === 'maintainable_equipment_asset_uq') throw error(409, 'Asset is already linked to maintainable equipment', 'EQUIPMENT_ASSET_ALREADY_LINKED'); throw cause; }
      await this.audit({ client: repo.db, entityType: 'maintainable_equipment', entityId: row.id, action: id ? 'MAINTAINABLE_EQUIPMENT_UPDATED' : 'MAINTAINABLE_EQUIPMENT_CREATED', actorUserId: ctx.userId, instituteId: ctx.instituteId, beforeData: before, afterData: row });
      return row;
    });
  }
}

module.exports = { EquipmentService, FIELDS, canonicalAssetFields };