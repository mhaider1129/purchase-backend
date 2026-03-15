const ATTACHMENTS_TABLE = 'attachments';
const ATTACHMENTS_SCHEMA = 'public';

const supportCache = new Map();

function getCacheKey(columnName) {
  return `${ATTACHMENTS_SCHEMA}.${ATTACHMENTS_TABLE}.${columnName}`;
}

function resetAttachmentColumnSupportCache(columnName) {
  if (columnName) {
    supportCache.delete(getCacheKey(columnName));
    return;
  }

  supportCache.clear();
}

function markAttachmentColumnSupport(columnName, value) {
  supportCache.set(getCacheKey(columnName), value ? true : false);
}

function getAttachmentColumnSupport(columnName) {
  return supportCache.get(getCacheKey(columnName));
}

async function attachmentsHasColumn(queryable, columnName) {
  const cachedSupport = getAttachmentColumnSupport(columnName);

  if (cachedSupport === true) {
    return true;
  }

  if (cachedSupport === false) {
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
      [ATTACHMENTS_SCHEMA, ATTACHMENTS_TABLE, columnName]
    );

    const supported = rows.length > 0;
    markAttachmentColumnSupport(columnName, supported);

    return supported;
  } catch (err) {
    console.error(`⚠️ Failed to inspect attachments.${columnName} schema:`, err.message);
    markAttachmentColumnSupport(columnName, true);
  }

  return true;
}

async function ensureAttachmentsColumn(queryable, {
  columnName,
  referenceTable,
  referenceColumn = 'id',
  indexName,
}) {
  const supported = await attachmentsHasColumn(queryable, columnName);

  if (supported) {
    return true;
  }

  try {
    await queryable.query(
      `ALTER TABLE ${ATTACHMENTS_SCHEMA}.${ATTACHMENTS_TABLE}
         ADD COLUMN IF NOT EXISTS ${columnName} BIGINT
         REFERENCES public.${referenceTable}(${referenceColumn})
         ON DELETE SET NULL`
    );

    await queryable.query(
      `CREATE INDEX IF NOT EXISTS ${indexName}
         ON ${ATTACHMENTS_SCHEMA}.${ATTACHMENTS_TABLE} (${columnName})`
    );

    resetAttachmentColumnSupportCache(columnName);
  } catch (err) {
    console.error(`⚠️ Failed to ensure attachments.${columnName} column:`, err.message);
    markAttachmentColumnSupport(columnName, false);
    return false;
  }

  return attachmentsHasColumn(queryable, columnName);
}

module.exports = {
  attachmentsHasColumn,
  ensureAttachmentsColumn,
  resetAttachmentColumnSupportCache,
};