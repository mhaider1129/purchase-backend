const pool = require('../config/db');

let ensured = false;

const statements = [
  `CREATE TABLE IF NOT EXISTS public.finance_chart_of_accounts (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    account_type TEXT NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS public.finance_cost_centers (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    department_id INTEGER REFERENCES public.departments(id),
    project_id UUID REFERENCES public.projects(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS public.budget_envelopes (
    id BIGSERIAL PRIMARY KEY,
    department_id INTEGER NOT NULL REFERENCES public.departments(id),
    project_id UUID REFERENCES public.projects(id),
    fiscal_year INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    allocated_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    consumed_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES public.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (department_id, project_id, fiscal_year, currency)
  )`,
  `CREATE TABLE IF NOT EXISTS public.commitment_ledger (
    id BIGSERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
    budget_envelope_id BIGINT NOT NULL REFERENCES public.budget_envelopes(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK (stage IN ('reservation', 'encumbrance', 'actual')),
    amount NUMERIC(14,2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    source_type TEXT,
    source_id TEXT,
    notes TEXT,
    actor_id INTEGER REFERENCES public.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS public.gl_postings (
    id BIGSERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_id TEXT,
    posting_reference TEXT NOT NULL UNIQUE,
    posting_status TEXT NOT NULL DEFAULT 'posted',
    currency TEXT NOT NULL DEFAULT 'USD',
    total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    posted_by INTEGER REFERENCES public.users(id),
    posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS public.gl_posting_lines (
    id BIGSERIAL PRIMARY KEY,
    gl_posting_id BIGINT NOT NULL REFERENCES public.gl_postings(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL,
    account_code TEXT NOT NULL,
    cost_center_id INTEGER REFERENCES public.finance_cost_centers(id),
    debit_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    credit_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_budget_envelopes_dept_proj ON public.budget_envelopes(department_id, project_id, fiscal_year)`,
  `CREATE INDEX IF NOT EXISTS idx_commitment_ledger_request ON public.commitment_ledger(request_id, stage)`,
  `CREATE INDEX IF NOT EXISTS idx_commitment_ledger_budget ON public.commitment_ledger(budget_envelope_id, stage)`,
  `CREATE INDEX IF NOT EXISTS idx_gl_postings_request ON public.gl_postings(request_id, posted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_gl_posting_lines_posting ON public.gl_posting_lines(gl_posting_id)`,
];

const seedDefaultAccounts = async (client) => {
  await client.query(
    `INSERT INTO public.finance_chart_of_accounts (code, name, account_type)
     VALUES
       ('5000-PROC-EXP', 'Procurement Expense', 'expense'),
       ('2100-AP-ACCRUAL', 'Accounts Payable Accrual', 'liability')
     ON CONFLICT (code) DO NOTHING`
  );
};

async function ensureFinanceCoreTables(client = null) {
  if (ensured && !client) {
    return;
  }

  const runner = client || pool;
  for (const statement of statements) {
    await runner.query(statement);
  }
  await seedDefaultAccounts(runner);

  if (!client) {
    ensured = true;
  }
}

module.exports = { ensureFinanceCoreTables, financeCoreStatements: statements };