const pool = require('../config/db');

let tableEnsured = false;

const ensureRequestedItemFinancialsTable = async (client = pool) => {
  if (tableEnsured) return;

  const runner = client.query ? client : pool;

  await runner.query(
    `CREATE SEQUENCE IF NOT EXISTS public.requested_item_financials_id_seq`,
  );

  await runner.query(`
    CREATE TABLE IF NOT EXISTS public.requested_item_financials (
      id integer NOT NULL DEFAULT nextval('requested_item_financials_id_seq'::regclass),
      requested_item_id integer NOT NULL,
      request_id integer NOT NULL,
      po_number text,
      invoice_number text,
      committed_cost numeric(14, 2),
      paid_cost numeric(14, 2),
      currency text,
      savings_driver text,
      savings_notes text,
      savings_baseline numeric(14, 2),
      contract_id integer,
      contract_value_snapshot numeric(14, 2),
      created_by integer,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT requested_item_financials_pkey PRIMARY KEY (id),
      CONSTRAINT requested_item_financials_requested_item_id_key UNIQUE (requested_item_id),
      CONSTRAINT requested_item_financials_requested_item_id_fkey FOREIGN KEY (requested_item_id) REFERENCES public.requested_items(id) ON DELETE CASCADE,
      CONSTRAINT requested_item_financials_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE,
      CONSTRAINT requested_item_financials_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id)
    )
  `);

  await runner.query(
    `CREATE INDEX IF NOT EXISTS requested_item_financials_item_idx ON public.requested_item_financials (requested_item_id)`,
  );
  await runner.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS requested_item_financials_item_uniq ON public.requested_item_financials (requested_item_id)`,
  );
  await runner.query(
    `CREATE INDEX IF NOT EXISTS requested_item_financials_request_idx ON public.requested_item_financials (request_id)`,
  );
  await runner.query(
    `CREATE INDEX IF NOT EXISTS requested_item_financials_contract_idx ON public.requested_item_financials (contract_id)`,
  );

  tableEnsured = true;
};

module.exports = { ensureRequestedItemFinancialsTable };