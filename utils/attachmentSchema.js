const ATTACHMENTS_TABLE = 'attachments';
const ATTACHMENTS_SCHEMA = 'public';
const ITEM_ID_COLUMN = 'item_id';
const ITEM_ID_INDEX = 'attachments_item_id_idx';

let attachmentItemIdSupported = null;

function resetAttachmentsItemIdSupportCache() {
  attachmentItemIdSupported = null;
}

function markItemIdSupport(value) {
  attachmentItemIdSupported = value ? true : false;
}

async function attachmentsHasItemIdColumn(queryable) {
  if (attachmentItemIdSupported === true) {
    return true;
  }

  if (attachmentItemIdSupported === false) {
    return false;
  }

  try {
    const { rows } = await queryable.query(
      `SELECT 1
         FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
          AND column_name = $3
        LIMIT 1`,
      [ATTACHMENTS_SCHEMA, ATTACHMENTS_TABLE, ITEM_ID_COLUMN]
    );
    const supported = rows.length > 0;

    markItemIdSupport(supported);

    return supported;
  } catch (err) {
    console.error('⚠️ Failed to inspect attachments schema:', err.message);
    attachmentItemIdSupported = true;
  }

  return true;
}

async function ensureAttachmentsItemIdColumn(queryable) {
  const supported = await attachmentsHasItemIdColumn(queryable);

  if (supported) {
    return true;
  }

  try {
    await queryable.query(
      `ALTER TABLE ${ATTACHMENTS_SCHEMA}.${ATTACHMENTS_TABLE}
         ADD COLUMN IF NOT EXISTS ${ITEM_ID_COLUMN} BIGINT
         REFERENCES public.requested_items(id)
         ON DELETE SET NULL`
    );

    await queryable.query(
      `CREATE INDEX IF NOT EXISTS ${ITEM_ID_INDEX}
         ON ${ATTACHMENTS_SCHEMA}.${ATTACHMENTS_TABLE} (${ITEM_ID_COLUMN})`
    );

    resetAttachmentsItemIdSupportCache();
  } catch (err) {
    console.error('⚠️ Failed to ensure attachments.item_id column:', err.message);
    markItemIdSupport(false);
    return false;
  }

  return attachmentsHasItemIdColumn(queryable);
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
  ensureAttachmentsItemIdColumn,
  resetAttachmentsItemIdSupportCache,
};