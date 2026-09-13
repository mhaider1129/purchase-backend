const pool = require('../config/db');
const withTransaction = require('../utils/withTransaction');

class EquipmentRepository {
  constructor(db = pool) { this.db = db; }
  transaction(work) { return withTransaction(client => work(new EquipmentRepository(client)), { pool: this.db }); }
  async get(id, instituteId, lock = false) {
    const result = await this.db.query(`SELECT e.id,e.institute_id,e.asset_id,e.equipment_code,
      CASE WHEN e.asset_id IS NULL THEN e.name ELSE a.description END name,
      CASE WHEN e.asset_id IS NULL THEN e.manufacturer ELSE a.manufacturer END manufacturer,
      CASE WHEN e.asset_id IS NULL THEN e.model ELSE a.model END model,
      CASE WHEN e.asset_id IS NULL THEN e.serial_number ELSE a.serial_number END serial_number,
      CASE WHEN e.asset_id IS NULL THEN e.department_id ELSE a.responsible_department_id END department_id,
      e.lifecycle_status,e.created_at,e.updated_at,a.asset_number,a.description asset_description,a.current_location_id,
      (SELECT count(*)::int FROM contract_equipment_coverage coverage WHERE coverage.equipment_id=e.id AND coverage.institute_id=e.institute_id AND CURRENT_DATE BETWEEN coverage.coverage_start AND coverage.coverage_end) active_contract_count,
      (SELECT count(*)::int FROM maintenance_work_orders work_order WHERE work_order.equipment_id=e.id AND work_order.institute_id=e.institute_id AND work_order.status IN('OPEN','IN_PROGRESS','ON_HOLD')) open_work_order_count,
      a.operational_status asset_operational_status,a.condition asset_condition
      FROM maintainable_equipment e LEFT JOIN assets a ON a.id=e.asset_id AND a.institute_id=e.institute_id
      WHERE e.id=$1 AND e.institute_id=$2${lock ? ' FOR UPDATE OF e' : ''}`, [id, instituteId]);
    return result.rows[0] || null;
  }
  async asset(id, instituteId) {
    if (!id) return null;
    const result = await this.db.query('SELECT * FROM assets WHERE id=$1 AND institute_id=$2 FOR SHARE', [id, instituteId]);
    return result.rows[0] || null;
  }
  async department(id, instituteId) {
    if (!id) return null;
    const result = await this.db.query('SELECT id FROM departments WHERE id=$1 AND institute_id=$2 FOR SHARE', [id, instituteId]);
    return result.rows[0] || null;
  }
  async availableAssets(instituteId, { search = '', limit = 50, includeAssetId } = {}) {
    limit = Math.min(100, Math.max(1, Number(limit) || 50));
    const result = await this.db.query(`SELECT a.id,a.asset_number,a.description,a.manufacturer,a.model,a.serial_number,
      a.responsible_department_id,a.operational_status
      FROM assets a LEFT JOIN maintainable_equipment e ON e.asset_id=a.id
      WHERE a.institute_id=$1 AND a.is_active=true AND a.operational_status<>'DISPOSED'
        AND (e.id IS NULL OR a.id=$2)
        AND ($3='' OR a.asset_number ILIKE '%'||$3||'%' OR a.description ILIKE '%'||$3||'%'
          OR a.serial_number ILIKE '%'||$3||'%' OR a.manufacturer ILIKE '%'||$3||'%' OR a.model ILIKE '%'||$3||'%')
      ORDER BY a.asset_number LIMIT $4`, [instituteId, includeAssetId || null, search, limit]);
    return result.rows;
  }
  async list(instituteId, { page = 1, limit = 25, search = '', linked } = {}) {
    limit = Math.min(100, Math.max(1, Number(limit) || 25)); page = Math.max(1, Number(page) || 1);
    const values = [instituteId, search]; const where = ['e.institute_id=$1'];
    if (linked === 'true') where.push('e.asset_id IS NOT NULL');
    if (linked === 'false') where.push('e.asset_id IS NULL');
    where.push(`($2='' OR e.equipment_code ILIKE '%'||$2||'%' OR
      CASE WHEN e.asset_id IS NULL THEN e.name ELSE a.description END ILIKE '%'||$2||'%' OR
      CASE WHEN e.asset_id IS NULL THEN e.manufacturer ELSE a.manufacturer END ILIKE '%'||$2||'%' OR
      CASE WHEN e.asset_id IS NULL THEN e.model ELSE a.model END ILIKE '%'||$2||'%' OR a.asset_number ILIKE '%'||$2||'%')`);
    values.push(limit, (page - 1) * limit);
    const result = await this.db.query(`SELECT e.id,e.institute_id,e.asset_id,e.equipment_code,
      CASE WHEN e.asset_id IS NULL THEN e.name ELSE a.description END name,
      CASE WHEN e.asset_id IS NULL THEN e.manufacturer ELSE a.manufacturer END manufacturer,
      CASE WHEN e.asset_id IS NULL THEN e.model ELSE a.model END model,
      CASE WHEN e.asset_id IS NULL THEN e.serial_number ELSE a.serial_number END serial_number,
      CASE WHEN e.asset_id IS NULL THEN e.department_id ELSE a.responsible_department_id END department_id,
      e.lifecycle_status,e.created_at,e.updated_at,a.asset_number,a.description asset_description,a.current_location_id,
      (SELECT count(*)::int FROM contract_equipment_coverage coverage WHERE coverage.equipment_id=e.id AND coverage.institute_id=e.institute_id AND CURRENT_DATE BETWEEN coverage.coverage_start AND coverage.coverage_end) active_contract_count,
      (SELECT count(*)::int FROM maintenance_work_orders work_order WHERE work_order.equipment_id=e.id AND work_order.institute_id=e.institute_id AND work_order.status IN('OPEN','IN_PROGRESS','ON_HOLD')) open_work_order_count,
      a.operational_status asset_operational_status,a.condition asset_condition,count(*) OVER()::int total_count
      FROM maintainable_equipment e LEFT JOIN assets a ON a.id=e.asset_id AND a.institute_id=e.institute_id
      WHERE ${where.join(' AND ')} ORDER BY CASE WHEN e.asset_id IS NULL THEN e.name ELSE a.description END,e.id LIMIT $3 OFFSET $4`, values);
    return { data: result.rows, pagination: { page, limit, total: result.rows[0]?.total_count || 0 } };
  }
  async save(id, instituteId, data) {
    const keys = Object.keys(data);
    if (id) {
      const result = await this.db.query(`UPDATE maintainable_equipment SET ${keys.map((key, index) => `${key}=$${index + 1}`).join(',')},updated_at=now() WHERE id=$${keys.length + 1} AND institute_id=$${keys.length + 2} RETURNING *`, [...keys.map(key => data[key]), id, instituteId]);
      return result.rows[0] || null;
    }
    const result = await this.db.query(`INSERT INTO maintainable_equipment(institute_id,${keys.join(',')}) VALUES($1,${keys.map((_, index) => `$${index + 2}`).join(',')}) RETURNING *`, [instituteId, ...keys.map(key => data[key])]);
    return result.rows[0];
  }
}

module.exports = EquipmentRepository;