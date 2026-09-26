-- Batch 1 P2P authority hardening. Run manually in a reviewed deployment window.
-- This migration intentionally blocks when historical identity/provenance cannot
-- be resolved without guessing; it never matches suppliers by display name.
BEGIN;

ALTER TABLE public.ap_payables ADD COLUMN IF NOT EXISTS supplier_id INTEGER;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.ap_payables ap
      LEFT JOIN public.supplier_invoices si ON si.id = ap.supplier_invoice_id
      LEFT JOIN public.purchase_orders po ON po.id = si.purchase_order_id
     WHERE si.id IS NULL
        OR po.id IS NULL
        OR si.supplier_id IS NULL
        OR po.supplier_id IS NULL
        OR si.supplier_id <> po.supplier_id
        OR (ap.supplier_id IS NOT NULL AND ap.supplier_id <> si.supplier_id)
  ) THEN
    RAISE EXCEPTION '031 blocked: ap_payables contains an unresolved or conflicting invoice/PO supplier chain; inspect with sql/verification/031_p2p_batch1_supplier_backfill.sql';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.document_flow_links
     GROUP BY request_id, source_document_type, source_document_id,
              target_document_type, target_document_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION '031 blocked: duplicate document-flow edges must be reviewed before the unique constraint is installed';
  END IF;
END $$;

UPDATE public.ap_payables ap
   SET supplier_id = si.supplier_id
  FROM public.supplier_invoices si
  JOIN public.purchase_orders po
    ON po.id = si.purchase_order_id
   AND po.supplier_id = si.supplier_id
 WHERE si.id = ap.supplier_invoice_id
   AND ap.supplier_id IS NULL;

ALTER TABLE public.ap_payables
  ALTER COLUMN supplier_id SET NOT NULL;

DO $constraint$
DECLARE existing_definition text;
BEGIN
  SELECT pg_get_constraintdef(c.oid, false)
    INTO existing_definition
    FROM pg_constraint c
   WHERE c.conrelid = 'public.ap_payables'::regclass
     AND c.conname = 'ap_payables_supplier_id_fkey';

  IF existing_definition IS NULL THEN
    ALTER TABLE public.ap_payables
      ADD CONSTRAINT ap_payables_supplier_id_fkey
      FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);
  ELSIF existing_definition NOT IN (
    'FOREIGN KEY (supplier_id) REFERENCES suppliers(id)',
    'FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id)'
  ) THEN
    RAISE EXCEPTION '031 drift: ap_payables_supplier_id_fkey exists with incompatible definition: %', existing_definition;
  END IF;
END
$constraint$;

DO $index$
DECLARE compatible boolean;
BEGIN
  IF to_regclass('public.idx_ap_payables_supplier_id') IS NULL THEN
    CREATE INDEX idx_ap_payables_supplier_id ON public.ap_payables(supplier_id);
    RETURN;
  END IF;

  SELECT i.indisvalid AND i.indisready AND NOT i.indisunique
         AND i.indnkeyatts = 1 AND i.indnatts = 1
         AND i.indpred IS NULL
         AND pg_get_indexdef(i.indexrelid, 1, true) = 'supplier_id'
         AND am.amname = 'btree'
    INTO compatible
    FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tbl.relnamespace
    JOIN pg_am am ON am.oid = idx.relam
   WHERE i.indexrelid = 'public.idx_ap_payables_supplier_id'::regclass
     AND n.nspname = 'public'
     AND tbl.relname = 'ap_payables';

  IF NOT coalesce(compatible, false) THEN
    RAISE EXCEPTION '031 drift: idx_ap_payables_supplier_id exists with an incompatible definition';
  END IF;
END
$index$;

DO $constraint$
DECLARE existing_definition text;
BEGIN
  SELECT pg_get_constraintdef(c.oid, false)
    INTO existing_definition
    FROM pg_constraint c
   WHERE c.conrelid = 'public.document_flow_links'::regclass
     AND c.conname = 'document_flow_links_unique_edge';

  IF existing_definition IS NULL THEN
    ALTER TABLE public.document_flow_links
      ADD CONSTRAINT document_flow_links_unique_edge
      UNIQUE (request_id, source_document_type, source_document_id,
              target_document_type, target_document_id);
  ELSIF existing_definition <> 'UNIQUE (request_id, source_document_type, source_document_id, target_document_type, target_document_id)' THEN
    RAISE EXCEPTION '031 drift: document_flow_links_unique_edge exists with incompatible definition: %', existing_definition;
  END IF;
END
$constraint$;

COMMIT;

-- Rollback (review dependants first):
-- ALTER TABLE public.document_flow_links DROP CONSTRAINT document_flow_links_unique_edge;
-- DROP INDEX public.idx_ap_payables_supplier_id;
-- ALTER TABLE public.ap_payables DROP CONSTRAINT ap_payables_supplier_id_fkey;
-- ALTER TABLE public.ap_payables DROP COLUMN supplier_id;