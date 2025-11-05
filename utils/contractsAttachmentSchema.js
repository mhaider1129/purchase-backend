const ATTACHMENTS_TABLE = 'attachments';
const ATTACHMENTS_SCHEMA = 'public';
const CONTRACT_ID_COLUMN = 'contract_id';
const CONTRACT_ID_INDEX = 'attachments_contract_id_idx';

let attachmentContractIdSupported = null;

function resetAttachmentsContractIdSupportCache() {
  attachmentContractIdSupported = null;
}

function markContractIdSupport(value) {
  attachmentContractIdSupported = value ? true : false;
}

async function attachmentsHasContractIdColumn(queryable) {
  if (attachmentContractIdSupported === true) {
    return true;
  }

  if (attachmentContractIdSupported === false) {
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
      [ATTACHMENTS_SCHEMA, ATTACHMENTS_TABLE, CONTRACT_ID_COLUMN]
    );
    const supported = rows.length > 0;

    markContractIdSupport(supported);

    return supported;
  } catch (err) {
    console.error('⚠️ Failed to inspect attachments schema:', err.message);
    attachmentContractIdSupported = true;
  }

  return true;
}

async function ensureAttachmentsContractIdColumn(queryable) {
  const supported = await attachmentsHasContractIdColumn(queryable);

  if (supported) {
    return true;
  }

  try {
    await queryable.query(
      `ALTER TABLE ${ATTACHMENTS_SCHEMA}.${ATTACHMENTS_TABLE}
         ADD COLUMN IF NOT EXISTS ${CONTRACT_ID_COLUMN} BIGINT
         REFERENCES public.contracts(id)
         ON DELETE SET NULL`
    );

    await queryable.query(
      `CREATE INDEX IF NOT EXISTS ${CONTRACT_ID_INDEX}
         ON ${ATTACHMENTS_SCHEMA}.${ATTACHMENTS_TABLE} (${CONTRACT_ID_COLUMN})`
    );

    resetAttachmentsContractIdSupportCache();
  } catch (err) {
    console.error('⚠️ Failed to ensure attachments.contract_id column:', err.message);
    markContractIdSupport(false);
    return false;
  }

  return attachmentsHasContractIdColumn(queryable);
}

module.exports = {
  attachmentsHasContractIdColumn,
  ensureAttachmentsContractIdColumn,
  resetAttachmentsContractIdSupportCache,
};