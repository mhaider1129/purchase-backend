const {
  attachmentsHasColumn,
  ensureAttachmentsColumn,
  resetAttachmentColumnSupportCache,
} = require('./attachmentsColumnSupport');

const CONTRACT_ID_COLUMN = 'contract_id';
const CONTRACT_ID_INDEX = 'attachments_contract_id_idx';

function resetAttachmentsContractIdSupportCache() {
  resetAttachmentColumnSupportCache(CONTRACT_ID_COLUMN);
}

function attachmentsHasContractIdColumn(queryable) {
  return attachmentsHasColumn(queryable, CONTRACT_ID_COLUMN);
}

function ensureAttachmentsContractIdColumn(queryable) {
  return ensureAttachmentsColumn(queryable, {
    columnName: CONTRACT_ID_COLUMN,
    referenceTable: 'contracts',
    indexName: CONTRACT_ID_INDEX,
  });
}

module.exports = {
  attachmentsHasContractIdColumn,
  ensureAttachmentsContractIdColumn,
  resetAttachmentsContractIdSupportCache,
};