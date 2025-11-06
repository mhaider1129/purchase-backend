const pool = require('../config/db');

let columnEnsured = false;

const ensureApprovalReminderColumn = async (client = pool) => {
  if (columnEnsured) return;

  const runner = typeof client.query === 'function' ? client : pool;

  await runner.query(
    `ALTER TABLE public.approvals ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ`
  );

  columnEnsured = true;
};

module.exports = ensureApprovalReminderColumn;
