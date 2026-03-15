const linkDocuments = async (client, {
  requestId,
  sourceType,
  sourceId,
  targetType,
  targetId,
  metadata = null,
  createdBy = null,
}) => {
  await client.query(
    `INSERT INTO document_flow_links (request_id, source_document_type, source_document_id, target_document_type, target_document_id, metadata, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      requestId,
      sourceType,
      String(sourceId),
      targetType,
      String(targetId),
      metadata ? JSON.stringify(metadata) : null,
      createdBy,
    ]
  );
};

module.exports = {
  linkDocuments,
};