const {
  attachmentsHasColumn,
  ensureAttachmentsColumn,
  resetAttachmentColumnSupportCache,
} = require('./attachmentsColumnSupport');

const ITEM_ID_COLUMN = 'item_id';
const ITEM_ID_INDEX = 'attachments_item_id_idx';

function resetAttachmentsItemIdSupportCache() {
  resetAttachmentColumnSupportCache(ITEM_ID_COLUMN);
}

function attachmentsHasItemIdColumn(queryable) {
  return attachmentsHasColumn(queryable, ITEM_ID_COLUMN);
}

function ensureAttachmentsItemIdColumn(queryable) {
  return ensureAttachmentsColumn(queryable, {
    columnName: ITEM_ID_COLUMN,
    referenceTable: 'requested_items',
    indexName: ITEM_ID_INDEX,
  });
}

const {
  attachmentsHasContractIdColumn,
  ensureAttachmentsContractIdColumn,
  resetAttachmentsContractIdSupportCache,
} = require('./contractsAttachmentSchema');

async function insertAttachment(queryable, { requestId = null, itemId = null, contractId = null, fileName, filePath, uploadedBy }) {
  if (!fileName || !filePath || !uploadedBy) {
    throw new Error('Missing required attachment fields');
  }

  const supportsItemId = await attachmentsHasItemIdColumn(queryable);
  const supportsContractId = await attachmentsHasContractIdColumn(queryable);

  if (itemId != null && !supportsItemId) {
    const error = new Error('Item-level attachments are not supported by the current database schema');
    error.code = 'ATTACHMENTS_ITEM_ID_UNSUPPORTED';
    throw error;
  }

  if (contractId != null && !supportsContractId) {
    const error = new Error('Contract-level attachments are not supported by the current database schema');
    error.code = 'ATTACHMENTS_CONTRACT_ID_UNSUPPORTED';
    throw error;
  }

  const columns = ['request_id', 'file_name', 'file_path', 'uploaded_by'];
  const values = [requestId, fileName, filePath, uploadedBy];

  if (supportsItemId) {
    columns.splice(1, 0, 'item_id');
    values.splice(1, 0, itemId);
  }

  if (supportsContractId) {
    columns.splice(1, 0, 'contract_id');
    values.splice(1, 0, contractId);
  }

  const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');

  return queryable.query(
    `INSERT INTO attachments (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    values
  );
}

module.exports = {
  insertAttachment,
  attachmentsHasItemIdColumn,
  ensureAttachmentsItemIdColumn,
  resetAttachmentsItemIdSupportCache,
  attachmentsHasContractIdColumn,
  ensureAttachmentsContractIdColumn,
  resetAttachmentsContractIdSupportCache,
};