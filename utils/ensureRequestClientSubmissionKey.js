const pool = require('../config/db');

let ensured = false;
let ensurePromise = null;

const ensureRequestClientSubmissionKey = async () => {
  if (ensured) return;

  if (!ensurePromise) {
    ensurePromise = (async () => {
      await pool.query(`ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS client_submission_key TEXT`);
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS requests_client_submission_key_unique_idx
         ON public.requests (client_submission_key)
         WHERE client_submission_key IS NOT NULL`
      );
      ensured = true;
    })().finally(() => {
      ensurePromise = null;
    });
  }

  await ensurePromise;
};

module.exports = ensureRequestClientSubmissionKey;