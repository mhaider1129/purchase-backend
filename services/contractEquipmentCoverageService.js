const ContractEquipmentCoverageRepository = require('../repositories/contractEquipmentCoverageRepository');
const { writeAuditEvent } = require('./auditService');

const error = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, ...(code && { code }) });
const TYPES = ['WARRANTY', 'PREVENTIVE', 'CORRECTIVE', 'COMPREHENSIVE', 'CALIBRATION', 'SOFTWARE_SUPPORT', 'OTHER'];
const BOOLEAN_FIELDS = ['pm_included', 'corrective_included', 'labor_included', 'parts_included', 'consumables_included', 'travel_included', 'software_included', 'calibration_included'];
const FIELDS = ['contract_id', 'coverage_type', 'coverage_start', 'coverage_end', ...BOOLEAN_FIELDS, 'response_time_hours', 'resolution_time_hours', 'uptime_target_percent', 'coverage_limit', 'currency', 'notes'];
const pick = input => Object.fromEntries(FIELDS.filter(key => Object.prototype.hasOwnProperty.call(input, key)).map(key => [key, input[key] === '' ? null : input[key]]));

class ContractEquipmentCoverageService {
  constructor(repo = new ContractEquipmentCoverageRepository(), audit = writeAuditEvent) { this.repo = repo; this.audit = audit; }
  async list(equipmentId, ctx) {
    if (!await this.repo.equipment(equipmentId, ctx.instituteId)) throw error(404, 'Equipment not found');
    return this.repo.list(equipmentId, ctx.instituteId);
  }
  async create(equipmentId, input, ctx) {
    const data = pick(input || {});
    if (!data.contract_id || !TYPES.includes(data.coverage_type) || !data.coverage_start || !data.coverage_end) throw error(400, 'Contract, coverage type, start date and end date are required');
    if (data.coverage_end < data.coverage_start) throw error(400, 'Coverage end date cannot precede start date');
    for (const field of ['response_time_hours', 'resolution_time_hours', 'coverage_limit']) if (data[field] != null && (!Number.isFinite(Number(data[field])) || Number(data[field]) < 0)) throw error(400, `${field} must be non-negative`);
    if (data.uptime_target_percent != null && (!Number.isFinite(Number(data.uptime_target_percent)) || Number(data.uptime_target_percent) < 0 || Number(data.uptime_target_percent) > 100)) throw error(400, 'uptime_target_percent must be between 0 and 100');
    for (const field of BOOLEAN_FIELDS) if (data[field] != null && typeof data[field] !== 'boolean') throw error(400, `${field} must be boolean`);
    return this.repo.transaction(async repo => {
      if (!await repo.equipment(equipmentId, ctx.instituteId, true)) throw error(404, 'Equipment not found');
      const contract = await repo.contract(data.contract_id, ctx.instituteId);
      if (!contract) throw error(400, 'Contract not found in institute', 'EQUIPMENT_CONTRACT_INVALID');
      if (contract.start_date && data.coverage_start < String(contract.start_date).slice(0, 10)) throw error(400, 'Coverage cannot start before the contract');
      if (contract.end_date && data.coverage_end > String(contract.end_date).slice(0, 10)) throw error(400, 'Coverage cannot end after the contract');
      if (await repo.overlapping(equipmentId, data.coverage_type, data.coverage_start, data.coverage_end, ctx.instituteId)) throw error(409, 'Overlapping coverage of this type already exists for the equipment', 'EQUIPMENT_CONTRACT_COVERAGE_OVERLAP');
      const row = await repo.create({ equipment_id: equipmentId, ...data }, ctx.instituteId, ctx.userId);
      await this.audit({ client: repo.db, entityType: 'contract_equipment_coverage', entityId: row.id, action: 'CONTRACT_EQUIPMENT_COVERAGE_CREATED', actorUserId: ctx.userId, instituteId: ctx.instituteId, afterData: row });
      return row;
    });
  }
  async remove(equipmentId, coverageId, ctx) {
    return this.repo.transaction(async repo => {
      if (!await repo.equipment(equipmentId, ctx.instituteId, true)) throw error(404, 'Equipment not found');
      const row = await repo.remove(coverageId, equipmentId, ctx.instituteId);
      if (!row) throw error(404, 'Contract coverage not found');
      await this.audit({ client: repo.db, entityType: 'contract_equipment_coverage', entityId: coverageId, action: 'CONTRACT_EQUIPMENT_COVERAGE_REMOVED', actorUserId: ctx.userId, instituteId: ctx.instituteId, beforeData: row });
      return row;
    });
  }
}

module.exports = { ContractEquipmentCoverageService, TYPES, FIELDS };