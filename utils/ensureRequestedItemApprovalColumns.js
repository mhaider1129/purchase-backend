const pool = require('../config/db');

let columnsEnsured = false;

const ensureRequestedItemApprovalColumns = async (client = pool) => {
  if (columnsEnsured) return;

  const runner = client.query ? client : pool;
  const statements = [
    `ALTER TABLE public.requested_items ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'Pending'`,
    `ALTER TABLE public.requested_items ALTER COLUMN approval_status SET DEFAULT 'Pending'`,
    `UPDATE public.requested_items SET approval_status = 'Pending' WHERE approval_status IS NULL`,
    `ALTER TABLE public.requested_items ADD COLUMN IF NOT EXISTS approval_comments TEXT`,
    `ALTER TABLE public.requested_items ADD COLUMN IF NOT EXISTS approved_by UUID`,
    `ALTER TABLE public.requested_items ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`
  ];

  for (const statement of statements) {
    await runner.query(statement);
  }

  columnsEnsured = true;
};

module.exports = ensureRequestedItemApprovalColumns;