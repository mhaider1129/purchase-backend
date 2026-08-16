const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');
const { resolveRequestItem, linkPendingItemRequest } = require('../../services/requestItemResolutionService');

const resolveIdentity = async (req,res,next) => {
  if (!req.user?.hasPermission?.('item-master.map')) return next(createHttpError(403, 'Item identity resolution permission is required'));
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result=await resolveRequestItem(client,Number(req.params.requestId),Number(req.params.itemId),req.body||{},req.user); await client.query('COMMIT'); res.json(result); }
  catch(error){ await client.query('ROLLBACK'); next(error); }
  finally { client.release(); }
};
module.exports = { resolveIdentity };
const linkPending = async (req,res,next) => {
  if (!req.user?.hasPermission?.('item-master.map')) return next(createHttpError(403, 'Item identity resolution permission is required'));
  const client=await pool.connect();
  try { await client.query('BEGIN'); const result=await linkPendingItemRequest(client,Number(req.params.requestId),Number(req.params.itemId),req.body||{},req.user); await client.query('COMMIT'); res.status(201).json(result); }
  catch(error){ await client.query('ROLLBACK'); next(error); } finally { client.release(); }
};
module.exports.linkPending = linkPending;