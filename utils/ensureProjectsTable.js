const pool = require('../config/db');

let projectsEnsured = false;

/**
 * Ensure project master data storage and request project links exist.
 *
 * Some deployed databases predate project tracking, so request creation can
 * fail when the app sends an optional project_id unless these structures are
 * lazily backfilled before the projects/requests endpoints run.
 */
const ensureProjectsTable = async (client = pool) => {
  if (projectsEnsured || process.env.NODE_ENV === 'test') {
    projectsEnsured = true;
    return;
  }

  const runner = client.query ? client : pool;

  await runner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  await runner.query(`
    CREATE TABLE IF NOT EXISTS public.projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      created_by INTEGER REFERENCES public.users(id)
    )
  `);

  await runner.query(
    `CREATE INDEX IF NOT EXISTS idx_projects_lower_name ON public.projects (LOWER(name))`
  );

  await runner.query(`
    CREATE TABLE IF NOT EXISTS public.project_department_visibility (
      project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
      department_id INTEGER NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (project_id, department_id)
    )
  `);

  await runner.query(
    `CREATE INDEX IF NOT EXISTS idx_project_department_visibility_department
       ON public.project_department_visibility(department_id)`
  );

  await runner.query(
    `ALTER TABLE IF EXISTS public.requests ADD COLUMN IF NOT EXISTS project_id UUID`
  );
  await runner.query(
    `ALTER TABLE IF EXISTS public.requests DROP CONSTRAINT IF EXISTS requests_project_id_fkey`
  );
  await runner.query(
    `ALTER TABLE IF EXISTS public.requests
       ADD CONSTRAINT requests_project_id_fkey
       FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL`
  );
  await runner.query(
    `CREATE INDEX IF NOT EXISTS idx_requests_project_id ON public.requests(project_id)`
  );

  projectsEnsured = true;
};

module.exports = ensureProjectsTable;