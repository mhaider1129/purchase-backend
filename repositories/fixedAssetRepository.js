const pool = require('../config/db');
const withTransaction = require('../utils/withTransaction');

class FixedAssetRepository {
  constructor(db = pool) { this.db = db; }
  transaction(work) { return withTransaction(client => work(new FixedAssetRepository(client)), { pool: this.db }); }
  query(sql, params) { return this.db.query(sql, params); }
  async asset(id, instituteId, lock = false) { const r = await this.query(`SELECT * FROM assets WHERE id=$1 AND institute_id=$2${lock ? ' FOR UPDATE' : ''}`, [id, instituteId]); return r.rows[0] || null; }
  async location(id, instituteId) { if (!id) return null; const r = await this.query('SELECT * FROM asset_locations WHERE id=$1 AND institute_id=$2', [id, instituteId]); return r.rows[0] || null; }
}
module.exports = FixedAssetRepository;