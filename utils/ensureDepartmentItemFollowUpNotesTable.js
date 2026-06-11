const pool = require('../config/db');

let ensured = false;

const ensureDepartmentItemFollowUpNotesTable = async () => {
  if (ensured) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.department_item_follow_up_notes (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NULL REFERENCES public.requests(id) ON DELETE CASCADE,
      requested_item_id INTEGER NULL REFERENCES public.requested_items(id) ON DELETE CASCADE,
      department_id INTEGER NOT NULL REFERENCES public.departments(id),
      section_id INTEGER NULL REFERENCES public.sections(id),
      created_by INTEGER NULL REFERENCES public.users(id),
      note TEXT NOT NULL,
      department_response TEXT NULL,
      next_follow_up_date DATE NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_department_item_follow_up_notes_item_id
      ON public.department_item_follow_up_notes(requested_item_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_department_item_follow_up_notes_department_id
      ON public.department_item_follow_up_notes(department_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_department_item_follow_up_notes_created_at
      ON public.department_item_follow_up_notes(created_at)
  `);

  ensured = true;
};

module.exports = ensureDepartmentItemFollowUpNotesTable;