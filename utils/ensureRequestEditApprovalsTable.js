const ensureRequestEditApprovalsTable = async (clientOrPool) => {
  const executor = clientOrPool;

  await executor.query(`
    CREATE TABLE IF NOT EXISTS public.request_edit_approvals (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
      approval_id INTEGER REFERENCES public.approvals(id) ON DELETE SET NULL,
      requested_by INTEGER REFERENCES public.users(id),
      status VARCHAR(20) NOT NULL DEFAULT 'Pending',
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_at TIMESTAMPTZ
    )
  `);

  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_request_edit_approvals_pending
      ON public.request_edit_approvals (request_id, status)
  `);

  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_request_edit_approvals_approval_id
      ON public.request_edit_approvals (approval_id)
  `);
};

module.exports = ensureRequestEditApprovalsTable;