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
    `ALTER TABLE public.requested_items ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`
  ];

  for (const statement of statements) {
    await runner.query(statement);
  }

  await runner.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'requested_items'
          AND column_name = 'approved_by'
      ) THEN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'requested_items'
            AND column_name = 'approved_by'
            AND data_type <> 'integer'
        ) THEN
          ALTER TABLE public.requested_items
            ALTER COLUMN approved_by DROP DEFAULT;
          ALTER TABLE public.requested_items
            ALTER COLUMN approved_by TYPE INTEGER USING NULL::INTEGER;
        END IF;
      ELSE
        ALTER TABLE public.requested_items ADD COLUMN approved_by INTEGER;
      END IF;
    END
    $$;
  `);

  columnsEnsured = true;
};

module.exports = ensureRequestedItemApprovalColumns;