-- Read-only diagnostics. A zero count is required in every result before 031.
SELECT COUNT(*) AS unresolved_or_conflicting_payables
  FROM public.ap_payables ap
  LEFT JOIN public.supplier_invoices si ON si.id = ap.supplier_invoice_id
  LEFT JOIN public.purchase_orders po ON po.id = si.purchase_order_id
 WHERE si.id IS NULL
    OR po.id IS NULL
    OR si.supplier_id IS NULL
    OR po.supplier_id IS NULL
    OR si.supplier_id <> po.supplier_id
    OR (ap.supplier_id IS NOT NULL AND ap.supplier_id <> si.supplier_id);

SELECT request_id, source_document_type, source_document_id,
       target_document_type, target_document_id, COUNT(*) AS copies
  FROM public.document_flow_links
 GROUP BY request_id, source_document_type, source_document_id,
          target_document_type, target_document_id
HAVING COUNT(*) > 1;