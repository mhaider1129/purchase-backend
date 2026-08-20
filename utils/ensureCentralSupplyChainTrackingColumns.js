const pool = require('../config/db');

const ensureCentralSupplyChainTrackingColumns = async (client = pool) => {
  await client.query(`
    ALTER TABLE public.requests
      ADD COLUMN IF NOT EXISTS sent_to_central_supply_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS sent_to_central_supply_by INTEGER REFERENCES public.users(id)
  `);
};

module.exports = ensureCentralSupplyChainTrackingColumns;