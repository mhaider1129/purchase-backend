const pool = require('../config/db');
const { loadPolicy, updatePolicy } = require('../services/maintenanceApprovalReportingPolicyService');
exports.get = async (_req, res, next) => {
  try { res.json(await loadPolicy(pool)); } catch (error) { next(error); }
};
exports.update = async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const policy = await updatePolicy(client, req.body || {}, req.user);
    await client.query('COMMIT');
    res.json(policy);
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    next(error);
  } finally { client?.release(); }
};
