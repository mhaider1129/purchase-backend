const pool = require('../config/db');

let columnsEnsured = false;

const ensureRequestedItemReceivedColumns = async (client = pool) => {
  if (columnsEnsured) return;

  const runner = client.query ? client : pool;

  const statements = [
    `ALTER TABLE public.requested_items ADD COLUMN IF NOT EXISTS is_received BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE public.requested_items ALTER COLUMN is_received SET DEFAULT FALSE`,
    `UPDATE public.requested_items SET is_received = COALESCE(is_received, FALSE)`,
    `ALTER TABLE public.requested_items ADD COLUMN IF NOT EXISTS received_by INTEGER`,
    `ALTER TABLE public.requested_items ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ`,
    `ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS receipt_prompt_sent_at TIMESTAMPTZ`,
    `ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS auto_received_at TIMESTAMPTZ`,
  ];

  for (const statement of statements) {
    await runner.query(statement);
  }

  columnsEnsured = true;
};

module.exports = ensureRequestedItemReceivedColumns;