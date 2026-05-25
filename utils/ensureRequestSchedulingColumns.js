const pool = require('../config/db');

let ensured = false;
let ensurePromise = null;

const ensureRequestSchedulingColumns = async () => {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ`);
      await pool.query(`CREATE INDEX IF NOT EXISTS requests_scheduled_for_idx ON requests (scheduled_for) WHERE status = 'Scheduled'`);
      ensured = true;
    })().finally(() => {
      ensurePromise = null;
    });
  }
  await ensurePromise;
};

module.exports = ensureRequestSchedulingColumns;