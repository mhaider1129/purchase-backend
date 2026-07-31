const ensureColumns = async (connection) => {
  await connection.query(
    "ALTER TABLE stock_item_requests ADD COLUMN IF NOT EXISTS review_notes TEXT",
  );
};

const findForUpdate = async (client, id) => {
  const result = await client.query(
    "SELECT * FROM stock_item_requests WHERE id = $1 FOR UPDATE",
    [id],
  );
  return result.rows[0] || null;
};

const updateStatus = async (client, { id, status, reviewerId, reviewNotes }) => {
  const result = await client.query(
    `UPDATE stock_item_requests
        SET status = $1, approved_by = $2, review_notes = $3
      WHERE id = $4 AND status = 'pending'
      RETURNING *`,
    [status, reviewerId, reviewNotes, id],
  );
  return result.rows[0] || null;
};

const writeAudit = (client, { action, actorId, requestId, description }) =>
  client.query(
    `INSERT INTO audit_logs (action, actor_id, target_id, description)
     VALUES ($1, $2, $3, $4)`,
    [action, actorId, requestId, description],
  );

const writeItemMasterAudit = (
  client,
  { stockItemId, action, actorId, reason, requestId },
) =>
  client.query(
    `INSERT INTO item_master_audit_events(entity_type,entity_id,action,actor_id,reason,new_values)
     VALUES('stock_item',$1,$2,$3,$4,$5)`,
    [stockItemId, action, actorId, reason, {
      stock_item_request_id: requestId,
      identity_source: "approved_exception",
      reused_existing: action === "legacy_creation_reused",
    }],
  );

module.exports = {
  ensureColumns,
  findForUpdate,
  updateStatus,
  writeAudit,
  writeItemMasterAudit,
};