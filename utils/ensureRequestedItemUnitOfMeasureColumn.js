const pool = require('../config/db');

const ensureRequestedItemUnitOfMeasureColumn = async (client = pool) => {
  await client.query(
    `ALTER TABLE public.requested_items ADD COLUMN IF NOT EXISTS unit_of_measure TEXT`,
  );
};

module.exports = ensureRequestedItemUnitOfMeasureColumn;