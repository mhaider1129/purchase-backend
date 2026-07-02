const pool = require('../config/db');

let ensured = false;
let ensurePromise = null;

const ensureRequesterSectionAssignments = async () => {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.user_section_assignments (
        user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        section_id INTEGER NOT NULL REFERENCES public.sections(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, section_id)
      )
    `);
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_user_section_assignments_section_id ON public.user_section_assignments(section_id)'
    );
    ensured = true;
  })().finally(() => {
    ensurePromise = null;
  });

  return ensurePromise;
};

module.exports = ensureRequesterSectionAssignments;