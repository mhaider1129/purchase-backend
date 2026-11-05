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
    throw Object.assign(new Error(`Unable to verify attachments.${columnName}`), {code:'DATABASE_MODULE_CONTRACT_UNVERIFIED',statusCode:503,cause:err});
  }

  return true;
}

async function ensureAttachmentsColumn(queryable, {
  columnName,
  referenceTable,
  referenceColumn = 'id',
  indexName,
}) {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  await require("./runtimeSchemaContract").assertModuleContract("utils/attachmentsColumnSupport.js#ensureAttachmentsColumn", queryable);
  if(!await attachmentsHasColumn(queryable,columnName))throw Object.assign(new Error('Required attachment reference is missing; review the manual release'),{code:'DATABASE_MODULE_CONTRACT_MISSING',statusCode:503});
  return true;
}

module.exports = {
  attachmentsHasColumn,
  ensureAttachmentsColumn,
  resetAttachmentColumnSupportCache,
};