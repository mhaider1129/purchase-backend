const pool = require('../config/db');

let columnEnsured = false;

const ensureRequestedItemPoIssuanceColumn = async (client = pool) => {
  if (columnEnsured) return;

  const runner = client.query ? client : pool;

  await runner.query(
    `ALTER TABLE public.requested_items ADD COLUMN IF NOT EXISTS po_issuance_method TEXT`,
  );

  columnEnsured = true;
};

module.exports = ensureRequestedItemPoIssuanceColumn;