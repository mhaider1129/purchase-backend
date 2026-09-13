const pool = require('../config/db');
const withTransaction = require('../utils/withTransaction');

class ContractEquipmentCoverageRepository {
  constructor(db = pool) { this.db = db; }
  transaction(work) { return withTransaction(client => work(new ContractEquipmentCoverageRepository(client)), { pool: this.db }); }
  async equipment(id, instituteId, lock = false) {
    const result = await this.db.query(`SELECT id,asset_id,equipment_code FROM maintainable_equipment WHERE id=$1 AND institute_id=$2${lock ? ' FOR UPDATE' : ''}`, [id, instituteId]);
    return result.rows[0] || null;
  }
  async contract(id, instituteId) {
    const result = await this.db.query(`SELECT c.id,c.title,c.reference_number,c.status,c.start_date,c.end_date,c.supplier_id
      FROM contracts c
      LEFT JOIN users creator ON creator.id=c.created_by
      LEFT JOIN departments owner_department ON owner_department.id=c.end_user_department_id
      LEFT JOIN users manager ON manager.id=c.contract_manager_id
      WHERE c.id=$1
        AND COALESCE(creator.institute_id,owner_department.institute_id,manager.institute_id)=$2
        AND (creator.institute_id IS NULL OR creator.institute_id=$2)
        AND (owner_department.institute_id IS NULL OR owner_department.institute_id=$2)
        AND (manager.institute_id IS NULL OR manager.institute_id=$2)
      FOR SHARE OF c`, [id, instituteId]);
    return result.rows[0] || null;
  }
  async list(equipmentId, instituteId) {
    const result = await this.db.query(`SELECT coverage.*,c.title contract_title,c.reference_number,c.status contract_status,
      c.start_date contract_start,c.end_date contract_end,c.supplier_id
      FROM contract_equipment_coverage coverage JOIN contracts c ON c.id=coverage.contract_id
      WHERE coverage.equipment_id=$1 AND coverage.institute_id=$2
      ORDER BY coverage.coverage_start DESC,coverage.id DESC`, [equipmentId, instituteId]);
    return result.rows;
  }
  async overlapping(equipmentId, coverageType, start, end, instituteId) {
    const result = await this.db.query(`SELECT id FROM contract_equipment_coverage
      WHERE equipment_id=$1 AND coverage_type=$2 AND institute_id=$3
        AND daterange(coverage_start,coverage_end,'[]') && daterange($4::date,$5::date,'[]')
      LIMIT 1`, [equipmentId, coverageType, instituteId, start, end]);
    return result.rows[0] || null;
  }
  async create(data, instituteId, actorId) {
    const keys = Object.keys(data);
    const result = await this.db.query(`INSERT INTO contract_equipment_coverage(institute_id,${keys.join(',')},created_by,updated_by)
      VALUES($1,${keys.map((_, index) => `$${index + 2}`).join(',')},$${keys.length + 2},$${keys.length + 2}) RETURNING *`, [instituteId, ...keys.map(key => data[key]), actorId]);
    return result.rows[0];
  }
  async remove(id, equipmentId, instituteId) {
    const result = await this.db.query('DELETE FROM contract_equipment_coverage WHERE id=$1 AND equipment_id=$2 AND institute_id=$3 RETURNING *', [id, equipmentId, instituteId]);
    return result.rows[0] || null;
  }
}

module.exports = ContractEquipmentCoverageRepository;