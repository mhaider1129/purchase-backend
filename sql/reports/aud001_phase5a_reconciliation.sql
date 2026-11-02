-- Read-only evidence report; not a migration or a duplicate-prevention key.
-- $1: required institute ID. $2: explicitly include unowned rows for owner review.
-- Run through scripts/lib/contractSettlementReconciliation.js in its READ ONLY
-- transaction. No application route or automatic source-to-AP mapping is added.
WITH roots AS (
 SELECT c.*,COALESCE(c.institute_id,r.institute_id,d.institute_id) owner_id,
   (c.source_request_id IS NOT NULL AND r.institute_id IS DISTINCT FROM COALESCE(c.institute_id,r.institute_id,d.institute_id)) OR
   (c.end_user_department_id IS NOT NULL AND d.institute_id IS DISTINCT FROM COALESCE(c.institute_id,r.institute_id,d.institute_id)) AS ownership_conflict
 FROM contracts c LEFT JOIN requests r ON r.id=c.source_request_id LEFT JOIN departments d ON d.id=c.end_user_department_id
), own_roots AS (
 SELECT * FROM roots WHERE owner_id=$1::int OR ($2::boolean AND owner_id IS NULL)
), canonical AS (
 SELECT i.*,r.institute_id owner_id,
   p.request_id IS DISTINCT FROM i.request_id OR p.supplier_id IS DISTINCT FROM i.supplier_id OR s.id IS NULL OR
   (s.institute_id IS NOT NULL AND s.institute_id IS DISTINCT FROM r.institute_id) OR
   (i.contract_id IS NOT NULL AND (c.id IS NULL OR c.owner_id IS DISTINCT FROM r.institute_id OR c.ownership_conflict)) AS source_conflict
 FROM supplier_invoices i LEFT JOIN requests r ON r.id=i.request_id LEFT JOIN purchase_orders p ON p.id=i.purchase_order_id
 LEFT JOIN suppliers s ON s.id=i.supplier_id LEFT JOIN roots c ON c.id=i.contract_id
 WHERE r.institute_id=$1::int OR ($2::boolean AND r.institute_id IS NULL)
), legacy AS (
 SELECT i.*,c.owner_id,c.ownership_conflict,c.supplier_id contract_supplier_id,
   COALESCE(i.supplier_id,c.supplier_id) effective_supplier_id,
   COALESCE(i.amount,0)+COALESCE(i.tax_amount,0)-COALESCE(i.discount_amount,0) gross_obligation,
   COUNT(*) OVER(PARTITION BY c.owner_id,COALESCE(i.supplier_id,c.supplier_id),LOWER(BTRIM(i.invoice_number))) legacy_identity_count,
   (SELECT COUNT(*) FROM suppliers ss WHERE LOWER(BTRIM(ss.name))=LOWER(BTRIM(c.vendor)) AND (ss.institute_id IS NULL OR ss.institute_id=c.owner_id)) supplier_name_candidates
 FROM contract_invoices i JOIN own_roots c ON c.id=i.contract_id
), invoice_candidates AS (
 SELECT l.id legacy_id,ARRAY_AGG(i.id ORDER BY i.id) ids,COUNT(*) candidates,
   BOOL_OR(i.source_conflict OR (i.contract_id IS NOT NULL AND i.contract_id<>l.contract_id) OR
     (l.currency IS NOT NULL AND i.currency IS NOT NULL AND UPPER(l.currency)<>UPPER(i.currency)) OR
     (l.invoice_date IS NOT NULL AND i.invoice_date IS NOT NULL AND l.invoice_date<>i.invoice_date) OR
     (UPPER(l.currency)=UPPER(i.currency) AND l.gross_obligation<>i.total_amount)) conflict
 FROM legacy l JOIN canonical i ON i.owner_id=l.owner_id AND i.supplier_id=l.effective_supplier_id
   AND NULLIF(LOWER(BTRIM(i.invoice_number)),'')=NULLIF(LOWER(BTRIM(l.invoice_number)),'')
 GROUP BY l.id
), allocation_evidence AS (
 SELECT a.*,p.payment_status,p.amount_paid,p.currency payment_currency,p.payment_reference,p.paid_at,p.reversal_of_payment_id,
   ap.supplier_invoice_id,ap.ap_voucher_id,ap.currency payable_currency,ap.invoice_total,ap.open_balance,ap.request_id,
   i.owner_id,i.supplier_id,i.invoice_number,i.invoice_date,i.currency invoice_currency,i.source_conflict,
   v.voucher_status,
   a.amount<=0 OR p.amount_paid<=0 OR p.supplier_invoice_id IS DISTINCT FROM ap.supplier_invoice_id OR
   p.ap_voucher_id IS DISTINCT FROM ap.ap_voucher_id OR p.request_id IS DISTINCT FROM ap.request_id OR
   UPPER(p.currency) IS DISTINCT FROM UPPER(ap.currency) OR UPPER(ap.currency) IS DISTINCT FROM UPPER(i.currency) AS allocation_conflict,
   EXISTS(SELECT 1 FROM finance_postings f WHERE f.ap_voucher_id=ap.ap_voucher_id AND f.supplier_invoice_id=i.id AND f.request_id=i.request_id AND LOWER(f.posting_status)='posted') AS posting_exists
 FROM payment_allocations a JOIN payment_records p ON p.id=a.payment_record_id
 JOIN ap_payables ap ON ap.id=a.ap_payable_id JOIN canonical i ON i.id=ap.supplier_invoice_id
 LEFT JOIN ap_vouchers v ON v.id=ap.ap_voucher_id
), report AS (
 SELECT 'legacy_invoice'::text record_type,l.id::text source_id,
 CASE WHEN l.ownership_conflict OR l.supplier_id IS NOT NULL AND l.contract_supplier_id IS NOT NULL AND l.supplier_id<>l.contract_supplier_id OR COALESCE(k.conflict,FALSE) OR l.legacy_identity_count>1 THEN 'Conflicting'
 WHEN l.owner_id IS NULL OR l.effective_supplier_id IS NULL OR NULLIF(BTRIM(l.invoice_number),'') IS NULL OR l.invoice_date IS NULL OR NULLIF(BTRIM(l.currency),'') IS NULL OR l.amount<=0 THEN 'Insufficient evidence'
 WHEN k.candidates>0 THEN 'Possible match' ELSE 'Unmatched' END classification,
 COALESCE(k.ids,ARRAY[]::bigint[]) candidate_ids,
 ARRAY_REMOVE(ARRAY[
 CASE WHEN l.owner_id IS NULL THEN 'missing_institute_ownership' END,
 CASE WHEN l.ownership_conflict THEN 'conflicting_contract_provenance' END,
 CASE WHEN l.effective_supplier_id IS NULL THEN 'missing_supplier_identity' END,
 CASE WHEN l.supplier_name_candidates>1 THEN 'ambiguous_supplier_name_not_used_as_identity' END,
 CASE WHEN NULLIF(BTRIM(l.invoice_number),'') IS NULL OR l.invoice_date IS NULL THEN 'missing_invoice_identity' END,
 CASE WHEN l.currency IS NULL THEN 'missing_currency' END,
 CASE WHEN l.amount<=0 THEN 'credit_or_adjustment_requires_review' END,
 CASE WHEN l.legacy_identity_count>1 THEN 'repeated_legacy_bill_identity_not_a_payment_deduplication_key' END,
 CASE WHEN k.conflict THEN 'candidate_currency_date_amount_source_or_contract_conflict' END,
 CASE WHEN k.candidates>0 THEN 'possible_duplicate_obligation_no_immutable_cross_ledger_mapping' ELSE 'no_canonical_bill_identity_candidate' END
 ],NULL)::text[] reasons,
 jsonb_build_object('contract_id',l.contract_id,'institute_id',l.owner_id,'supplier_id',l.effective_supplier_id,'invoice_number',l.invoice_number,'invoice_date',l.invoice_date,'currency',l.currency,'amount_before_tax',l.amount::text,'gross_obligation',l.gross_obligation::text,'net_payable_after_retention_penalty',l.net_payable_amount::text,'retention',l.retention_amount::text,'penalty',l.penalty_amount::text,'status',l.status) evidence
 FROM legacy l LEFT JOIN invoice_candidates k ON k.legacy_id=l.id
 UNION ALL
 SELECT 'legacy_payment',p.id::text,
 CASE WHEN c.ownership_conflict OR (p.invoice_id IS NOT NULL AND l.id IS NULL) OR (l.id IS NOT NULL AND UPPER(p.currency) IS DISTINCT FROM UPPER(l.currency)) THEN 'Conflicting'
 WHEN c.owner_id IS NULL OR p.invoice_id IS NULL OR l.id IS NULL OR COALESCE(l.effective_supplier_id,c.supplier_id) IS NULL OR p.currency IS NULL OR p.amount<=0 THEN 'Insufficient evidence'
 WHEN cardinality(k.ids)>0 OR cardinality(matches.ids)>0 THEN 'Possible match' ELSE 'Unmatched' END,
 COALESCE(matches.ids,ARRAY[]::bigint[]),
 ARRAY_REMOVE(ARRAY[
 CASE WHEN c.owner_id IS NULL THEN 'missing_institute_ownership' END,
 CASE WHEN p.invoice_id IS NULL THEN 'advance_or_unmatched_payment_no_invoice_mapping' END,
 CASE WHEN p.invoice_id IS NOT NULL AND l.id IS NULL THEN 'missing_or_foreign_legacy_invoice_reference' END,
 CASE WHEN l.id IS NOT NULL AND UPPER(p.currency) IS DISTINCT FROM UPPER(l.currency) THEN 'legacy_payment_invoice_currency_conflict' END,
 CASE WHEN p.amount<=0 THEN 'credit_or_reversal_requires_review' END,
 CASE WHEN cardinality(matches.ids)>0 THEN 'possible_duplicate_settlement_reference_not_proof_of_duplicate_payment' END,
 CASE WHEN cardinality(k.ids)>0 THEN 'possible_duplicate_obligation_installments_must_be_reviewed_separately' END,
 'no_automatic_merge_or_settlement_replay'],NULL)::text[],
 jsonb_build_object('contract_id',p.contract_id,'institute_id',c.owner_id,'invoice_id',p.invoice_id,'supplier_id',COALESCE(l.effective_supplier_id,c.supplier_id),'currency',p.currency,'amount',p.amount::text,'payment_date',p.payment_date,'payment_reference',p.payment_reference,'status',p.status,'canonical_invoice_candidates',COALESCE(k.ids,ARRAY[]::bigint[]))
 FROM contract_payments p JOIN own_roots c ON c.id=p.contract_id LEFT JOIN legacy l ON l.id=p.invoice_id AND l.contract_id=p.contract_id
 LEFT JOIN invoice_candidates k ON k.legacy_id=l.id
 LEFT JOIN LATERAL(SELECT ARRAY_AGG(DISTINCT ae.payment_record_id ORDER BY ae.payment_record_id) ids FROM allocation_evidence ae
 WHERE ae.owner_id=c.owner_id AND ae.supplier_id=COALESCE(l.effective_supplier_id,c.supplier_id)
 AND NULLIF(BTRIM(ae.payment_reference),'')=NULLIF(BTRIM(p.payment_reference),'')
 AND UPPER(ae.payment_currency)=UPPER(p.currency) AND ae.amount=p.amount AND LOWER(ae.payment_status)='paid' AND LOWER(p.status)='paid')matches ON TRUE
 UNION ALL
 SELECT 'canonical_supplier_invoice',i.id::text,
 CASE WHEN i.owner_id IS NULL OR i.supplier_id IS NULL OR i.invoice_date IS NULL OR i.currency IS NULL THEN 'Insufficient evidence' WHEN i.source_conflict THEN 'Conflicting' WHEN EXISTS(SELECT 1 FROM invoice_candidates k WHERE i.id=ANY(k.ids)) THEN 'Possible match' ELSE 'Unmatched' END,
 ARRAY(SELECT k.legacy_id FROM invoice_candidates k WHERE i.id=ANY(k.ids))::bigint[],ARRAY['canonical_invoice_identity_not_a_legacy_settlement_mapping']::text[],
 jsonb_build_object('request_id',i.request_id,'institute_id',i.owner_id,'supplier_id',i.supplier_id,'invoice_number',i.invoice_number,'invoice_date',i.invoice_date,'currency',i.currency,'total_amount',i.total_amount::text,'contract_id',i.contract_id,'purchase_order_id',i.purchase_order_id,'status',i.status)
 FROM canonical i
 UNION ALL
 SELECT 'posted_payable',ap.id::text,
 CASE WHEN i.owner_id IS NULL THEN 'Insufficient evidence' WHEN i.source_conflict OR ap.invoice_total IS DISTINCT FROM i.total_amount OR v.total_amount IS DISTINCT FROM i.total_amount OR ap.request_id IS DISTINCT FROM i.request_id OR ap.supplier_id IS DISTINCT FROM i.supplier_id OR UPPER(ap.currency) IS DISTINCT FROM UPPER(i.currency) THEN 'Conflicting'
 WHEN LOWER(v.voucher_status)='posted' AND EXISTS(SELECT 1 FROM finance_postings f WHERE f.ap_voucher_id=v.id AND f.supplier_invoice_id=i.id AND f.liability_recognized_amount=ap.invoice_total AND LOWER(f.posting_status)='posted') THEN 'Confirmed match' ELSE 'Insufficient evidence' END,
 ARRAY[i.id]::bigint[],ARRAY['classification_describes_canonical_posting_provenance_only_not_cross_ledger_reconciliation']::text[],
 jsonb_build_object('invoice_id',i.id,'voucher_id',ap.ap_voucher_id,'institute_id',i.owner_id,'supplier_id',ap.supplier_id,'currency',ap.currency,'invoice_total',ap.invoice_total::text,'recorded_open_balance',ap.open_balance::text,'status',ap.payable_status,'allocated_paid_value',(SELECT COALESCE(SUM(ae.amount),0)::text FROM allocation_evidence ae WHERE ae.ap_payable_id=ap.id AND LOWER(ae.payment_status)='paid'))
 FROM ap_payables ap JOIN canonical i ON i.id=ap.supplier_invoice_id LEFT JOIN ap_vouchers v ON v.id=ap.ap_voucher_id
 UNION ALL
 SELECT 'canonical_payment_allocation',a.id::text,
 CASE WHEN a.source_conflict OR a.allocation_conflict THEN 'Conflicting'
 WHEN a.owner_id IS NULL OR a.reversal_of_payment_id IS NOT NULL OR NOT a.posting_exists OR LOWER(a.voucher_status) IS DISTINCT FROM 'posted' OR LOWER(a.payment_status) IS DISTINCT FROM 'paid' THEN 'Insufficient evidence' ELSE 'Confirmed match' END,
 ARRAY[a.supplier_invoice_id]::bigint[],ARRAY['immutable_fk_chain_evidence_not_bank_reconciliation_or_cross_ledger_duplicate_proof']::text[],
 jsonb_build_object('payment_id',a.payment_record_id,'payable_id',a.ap_payable_id,'invoice_id',a.supplier_invoice_id,'voucher_id',a.ap_voucher_id,'institute_id',a.owner_id,'supplier_id',a.supplier_id,'currency',a.payment_currency,'allocated_amount',a.amount::text,'payment_amount',a.amount_paid::text,'payment_reference',a.payment_reference,'paid_at',a.paid_at,'reversal_of_payment_id',a.reversal_of_payment_id,'status',a.payment_status)
 FROM allocation_evidence a
 UNION ALL
 SELECT 'canonical_payment_record',p.id::text,
 CASE WHEN r.institute_id IS NULL THEN 'Insufficient evidence'
 WHEN i.id IS NOT NULL AND (i.owner_id IS DISTINCT FROM r.institute_id OR i.source_conflict) THEN 'Conflicting'
 WHEN i.id IS NULL OR p.reversal_of_payment_id IS NOT NULL OR LOWER(p.payment_status) IS DISTINCT FROM 'paid' OR
      NOT EXISTS(SELECT 1 FROM allocation_evidence ae WHERE ae.payment_record_id=p.id) THEN 'Insufficient evidence'
 WHEN EXISTS(SELECT 1 FROM allocation_evidence ae WHERE ae.payment_record_id=p.id AND (ae.allocation_conflict OR NOT ae.posting_exists)) THEN 'Conflicting'
 WHEN p.amount_paid IS DISTINCT FROM (SELECT SUM(a.amount) FROM payment_allocations a WHERE a.payment_record_id=p.id) THEN 'Insufficient evidence'
 ELSE 'Confirmed match' END,
 ARRAY(SELECT a.ap_payable_id FROM payment_allocations a WHERE a.payment_record_id=p.id)::bigint[],
 ARRAY['allocation_completeness_and_ERP_record_only_not_bank_settlement_or_duplicate_proof']::text[],
 jsonb_build_object('request_id',p.request_id,'institute_id',r.institute_id,'invoice_id',p.supplier_invoice_id,'voucher_id',p.ap_voucher_id,'amount_paid',p.amount_paid::text,'currency',p.currency,'payment_reference',p.payment_reference,'status',p.payment_status,'reversal_of_payment_id',p.reversal_of_payment_id)
 FROM payment_records p LEFT JOIN requests r ON r.id=p.request_id LEFT JOIN canonical i ON i.id=p.supplier_invoice_id
 WHERE r.institute_id=$1::int OR ($2::boolean AND r.institute_id IS NULL)
 UNION ALL
 SELECT 'legacy_consumption',v.id::text,
 CASE WHEN c.owner_id IS NULL THEN 'Insufficient evidence' WHEN c.ownership_conflict OR (v.invoice_id IS NOT NULL AND (l.id IS NULL OR UPPER(v.currency) IS DISTINCT FROM UPPER(l.currency))) THEN 'Conflicting' ELSE 'Insufficient evidence' END,
 ARRAY[]::bigint[],ARRAY['consumption_source_value_is_not_posted_liability_or_paid_value','source_mapping_requires_review_no_automatic_actualization']::text[],
 jsonb_build_object('contract_id',v.contract_id,'institute_id',c.owner_id,'source_type',v.source_type,'source_id',v.source_id,'invoice_id',v.invoice_id,'amount',v.amount::text,'currency',v.currency,'consumption_date',v.consumption_date)
 FROM contract_consumption v JOIN own_roots c ON c.id=v.contract_id LEFT JOIN legacy l ON l.id=v.invoice_id AND l.contract_id=v.contract_id
 UNION ALL
 SELECT 'contract_balance',c.id::text,CASE WHEN c.owner_id IS NULL THEN 'Insufficient evidence' WHEN c.ownership_conflict THEN 'Conflicting' ELSE 'Unmatched' END,ARRAY[]::bigint[],
 ARRAY['commercial_capacity_commitment_receipt_invoice_payable_and_paid_values_are_not_interchangeable','historical_counters_not_recalculated_or_overwritten']::text[],
 jsonb_build_object('institute_id',c.owner_id,'currency',c.currency,'commercial_contract_value',c.contract_value::text,'legacy_header_paid',c.amount_paid::text,'legacy_header_consumed',c.actual_consumed_value::text,'recorded_commercial_commitment',c.committed_value::text,'recorded_contract_capacity',c.framework_remaining_balance::text,
 'legacy_paid_by_currency',(SELECT COALESCE(jsonb_object_agg(x.currency,x.amount),'{}'::jsonb) FROM(SELECT COALESCE(p.currency,'UNKNOWN') currency,SUM(p.amount)::text amount FROM contract_payments p WHERE p.contract_id=c.id AND LOWER(p.status)='paid' GROUP BY COALESCE(p.currency,'UNKNOWN'))x))
 FROM own_roots c
)
SELECT * FROM report ORDER BY record_type,source_id;
