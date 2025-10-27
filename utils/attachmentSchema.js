const ATTACHMENTS_TABLE = 'attachments';
const ATTACHMENTS_SCHEMA = 'public';

let attachmentItemIdSupported = null;

async function attachmentsHasItemIdColumn(queryable) {
  if (attachmentItemIdSupported !== null) {
    return attachmentItemIdSupported;
  }

  try {
    const { rows } = await queryable.query(
      `SELECT 1
         FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
          AND column_name = 'item_id'
        LIMIT 1`,
      [ATTACHMENTS_SCHEMA, ATTACHMENTS_TABLE]
    );
    attachmentItemIdSupported = rows.length > 0;
  } catch (err) {
    console.error('⚠️ Failed to inspect attachments schema:', err.message);
    attachmentItemIdSupported = true;
  }

  return attachmentItemIdSupported;
}

async function insertAttachment(queryable, { requestId = null, itemId = null, fileName, filePath, uploadedBy }) {
  if (!fileName || !filePath || !uploadedBy) {
    throw new Error('Missing required attachment fields');
  }

  const supportsItemId = await attachmentsHasItemIdColumn(queryable);

  if (itemId != null && !supportsItemId) {
    const error = new Error('Item-level attachments are not supported by the current database schema');
    error.code = 'ATTACHMENTS_ITEM_ID_UNSUPPORTED';
    throw error;
  }

  const columns = ['request_id', 'file_name', 'file_path', 'uploaded_by'];
  const values = [requestId, fileName, filePath, uploadedBy];

  if (supportsItemId) {
    columns.splice(1, 0, 'item_id');
    values.splice(1, 0, itemId);
  }

  const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');

  return queryable.query(
    `INSERT INTO ${ATTACHMENTS_TABLE} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    values
  );
}

module.exports = {
  insertAttachment,
  attachmentsHasItemIdColumn,
};