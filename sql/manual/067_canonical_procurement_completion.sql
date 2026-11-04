-- MANUAL DATABASE MIGRATION REQUIRED. Prerequisite: complete canonical schema 059.
-- Read-only authority. No historical status/timestamp/quantity backfill.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE INDEX IF NOT EXISTS inventory_transactions_completion_source_idx ON public.inventory_transactions(source_document_type,source_document_id,source_document_line_id,institute_id);

CREATE OR REPLACE FUNCTION public.canonical_supply_quantity(p_item_id integer,p_institute_id integer)
RETURNS numeric LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 WITH supplied AS (
 SELECT s.id,s.supplied_quantity,
   COALESCE((SELECT SUM(-m.quantity-COALESCE((SELECT SUM(rv.quantity) FROM public.inventory_transactions rv WHERE rv.reversal_of_movement_id=m.id AND rv.institute_id=m.institute_id AND rv.warehouse_id=m.warehouse_id),0))
    FROM public.inventory_transactions m JOIN public.stock_items stock ON stock.id=m.stock_item_id
    WHERE m.movement_type='ISSUE' AND m.reversal_of_movement_id IS NULL AND m.quantity<0 AND m.stock_status='AVAILABLE'
      AND m.source_document_type='warehouse_supply' AND m.source_document_id=r.id::text AND m.source_document_line_id=s.id::text
      AND m.institute_id=p_institute_id AND m.warehouse_id=r.supply_warehouse_id AND m.department_id=r.department_id
      AND (ri.id IS NULL OR (ri.generic_item_id IS NULL OR ri.generic_item_id=stock.generic_item_id))
      AND (ri.id IS NULL OR (upper(trim(COALESCE(ri.unit_of_measure,'')))=upper(trim(m.base_uom)) OR EXISTS(SELECT 1 FROM public.item_uom completion_uom WHERE completion_uom.id=stock.inventory_uom_id AND upper(trim(ri.unit_of_measure)) IN (upper(trim(completion_uom.uom_code)),upper(trim(completion_uom.uom_name))))))),0) net_issue
 FROM public.warehouse_supply_items wsi JOIN public.requests r ON r.id=wsi.request_id
 JOIN public.warehouses w ON w.id=r.supply_warehouse_id AND w.institute_id=r.institute_id
 JOIN public.warehouse_supplied_items s ON s.item_id=wsi.id AND s.request_id=r.id
 LEFT JOIN public.requested_items ri ON ri.id=wsi.requested_item_id
 LEFT JOIN public.requests original_request ON original_request.id=ri.request_id
 WHERE wsi.id=p_item_id AND r.institute_id=p_institute_id AND r.request_type='Warehouse Supply'
 AND lower(trim(r.status)) IN ('approved','completed','received','closed')
 AND lower(trim(COALESCE(to_jsonb(wsi)->>'approval_status','approved'))) <> 'rejected'
 AND (wsi.requested_item_id IS NULL OR ri.id IS NOT NULL)
 AND (ri.id IS NULL OR (original_request.institute_id=r.institute_id AND original_request.department_id=r.department_id))
 ) SELECT COALESCE(SUM(LEAST(supplied_quantity,GREATEST(net_issue,0))),0) FROM supplied
$$;

CREATE OR REPLACE FUNCTION public.canonical_procurement_completion(p_request_id integer,p_institute_id integer,p_item_id integer DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
WITH root AS MATERIALIZED (
 SELECT r.* FROM public.requests r JOIN public.departments d ON d.id=r.department_id AND d.institute_id=r.institute_id
 WHERE r.id=p_request_id AND r.institute_id=p_institute_id
), demand AS MATERIALIZED (
 SELECT ri.*,r.institute_id,r.department_id,r.requester_id,
   EXISTS(SELECT 1 FROM public.warehouse_supply_items wsi JOIN public.requests wr ON wr.id=wsi.request_id
      WHERE wsi.requested_item_id=ri.id AND wr.request_type='Warehouse Supply' AND wr.institute_id=r.institute_id AND wr.department_id=r.department_id) diverted,
   lower(trim(COALESCE(ri.approval_status,''))) IN ('available in stock','available_in_stock','in stock','in_stock')
    OR lower(trim(COALESCE(ri.procurement_status,''))) IN ('available in stock','available_in_stock','in stock','in_stock') stock_available
 FROM root r JOIN public.requested_items ri ON ri.request_id=r.id
 WHERE r.request_type<>'Warehouse Supply' AND (p_item_id IS NULL OR ri.id=p_item_id)
), po_lines AS MATERIALIZED (
 SELECT b.id item_id,p.id po_id,pi.id line_id,pi.quantity,pi.line_type,pi.source_uom,pi.base_uom,pi.conversion_factor,
   CASE WHEN pi.conversion_factor>0 AND (upper(trim(pi.base_uom))=upper(trim(b.unit_of_measure)) OR EXISTS(SELECT 1 FROM public.item_uom completion_uom WHERE completion_uom.id=pi.base_uom_id AND upper(trim(completion_uom.uom_name))=upper(trim(b.unit_of_measure)))) THEN pi.conversion_factor
    WHEN b.generic_item_id IS NULL AND pi.conversion_factor=1 AND upper(trim(pi.source_uom))=upper(trim(b.unit_of_measure)) AND (upper(trim(pi.base_uom))=upper(trim(b.unit_of_measure)) OR EXISTS(SELECT 1 FROM public.item_uom completion_uom WHERE completion_uom.id=pi.base_uom_id AND upper(trim(completion_uom.uom_name))=upper(trim(b.unit_of_measure)))) THEN 1 ELSE NULL END demand_factor
 FROM demand b JOIN public.purchase_order_items pi ON pi.requested_item_id=b.id
 JOIN public.purchase_orders p ON p.id=pi.purchase_order_id AND p.request_id=b.request_id
 JOIN public.suppliers s ON s.id=p.supplier_id AND (to_jsonb(s)?'institute_id' AND ((to_jsonb(s)->>'institute_id') IS NULL OR (to_jsonb(s)->>'institute_id')::integer=b.institute_id))
 WHERE p.status IN ('PO_ISSUED','PO_PARTIAL','PO_DELIVERED','PO_CLOSED')
 AND (to_jsonb(pi)->>'request_id' IS NULL OR (to_jsonb(pi)->>'request_id')::integer=b.request_id)
 AND (to_jsonb(pi)->>'request_item_id' IS NULL OR (to_jsonb(pi)->>'request_item_id')::bigint=b.id)
), receipts AS MATERIALIZED (
 SELECT b.id item_id,l.line_id,l.po_id,l.line_type,l.demand_factor,l.conversion_factor,l.base_uom,
 gri.id receipt_line_id,gri.stock_status,gri.received_quantity,gri.damaged_quantity,gri.short_quantity,
 COALESCE((to_jsonb(gri)->>'technical_inspection_required')::boolean,false) inspection_required,
 CASE WHEN COALESCE((to_jsonb(gri)->>'technical_inspection_required')::boolean,false)
   THEN COALESCE((to_jsonb(gri)->>'technical_accepted_quantity')::numeric,0)
   ELSE GREATEST(gri.received_quantity-gri.damaged_quantity-gri.short_quantity,0) END accepted,
 COALESCE((to_jsonb(gri)->>'technical_rejected_quantity')::numeric,0) technical_rejected,
 COALESCE((SELECT SUM(m.quantity+COALESCE((SELECT SUM(rv.quantity) FROM public.inventory_transactions rv WHERE rv.reversal_of_movement_id=m.id AND rv.institute_id=m.institute_id AND rv.warehouse_id=m.warehouse_id),0))
   FROM public.inventory_transactions m JOIN public.stock_items stock ON stock.id=m.stock_item_id
   WHERE m.movement_type='GOODS_RECEIPT' AND m.reversal_of_movement_id IS NULL AND m.quantity>0 AND m.stock_status='AVAILABLE'
    AND m.source_document_type='goods_receipt' AND m.source_document_id=gr.id::text AND m.source_document_line_id=gri.id::text
    AND m.institute_id=b.institute_id AND m.warehouse_id=gri.warehouse_id
    AND upper(trim(m.base_uom))=upper(trim(l.base_uom))
    AND (gri.generic_item_id IS NULL OR stock.generic_item_id=gri.generic_item_id)
    AND (gri.stock_item_id IS NULL OR stock.id=gri.stock_item_id)),0) net_available_received_base
 FROM demand b JOIN po_lines l ON l.item_id=b.id
 JOIN public.goods_receipt_items gri ON gri.purchase_order_item_id=l.line_id AND gri.requested_item_id=b.id
 JOIN public.goods_receipts gr ON gr.id=gri.goods_receipt_id AND gr.purchase_order_id=l.po_id AND gr.request_id=b.request_id
 WHERE (gri.warehouse_id IS NULL OR EXISTS(SELECT 1 FROM public.warehouses w WHERE w.id=gri.warehouse_id AND w.institute_id=b.institute_id))
 AND upper(COALESCE(to_jsonb(gr)->>'status','POSTED')) NOT IN ('CANCELLED','CANCELED','VOIDED')
), receipt_totals AS MATERIALIZED (
 SELECT item_id,COALESCE(SUM(received_quantity*demand_factor),0) delivered,
 COALESCE(SUM((damaged_quantity+technical_rejected)*demand_factor),0) rejected,
 COALESCE(SUM(CASE WHEN inspection_required THEN GREATEST(received_quantity-damaged_quantity-short_quantity-accepted-technical_rejected,0)*demand_factor WHEN stock_status='QUARANTINE' THEN GREATEST(received_quantity-damaged_quantity-short_quantity,0)*demand_factor ELSE 0 END),0) quarantined,
 COALESCE(SUM(CASE WHEN line_type='NON_INVENTORY' AND stock_status<>'QUARANTINE' THEN accepted*demand_factor ELSE 0 END),0) direct_accepted,
 COALESCE(SUM(CASE WHEN line_type='INVENTORY' AND conversion_factor>0 THEN LEAST(accepted*demand_factor,GREATEST(net_available_received_base,0)*demand_factor/conversion_factor) ELSE 0 END),0) inventory_accepted,
 BOOL_OR(inspection_required AND accepted+technical_rejected < GREATEST(received_quantity-damaged_quantity-short_quantity,0)) inspection_pending
 FROM receipts GROUP BY item_id
), item_facts AS (
 SELECT b.id::bigint line_id,b.id::bigint requested_item_id,'requested_item'::text line_kind,b.quantity::numeric quantity,b.unit_of_measure uom,
 lower(trim(COALESCE(b.approval_status,'')))<>'rejected' OR b.diverted eligible,
 b.stock_available OR (lower(trim(COALESCE(b.approval_status,'')))='rejected' AND b.diverted) stock_resolved,
 COALESCE((SELECT SUM(l.quantity*l.demand_factor) FROM po_lines l WHERE l.item_id=b.id),0) ordered,
 COALESCE(t.delivered,0) delivered,COALESCE(t.rejected,0) rejected,COALESCE(t.quarantined,0) quarantined,
 COALESCE(t.direct_accepted,0) direct_accepted,COALESCE(t.inventory_accepted,0) inventory_accepted,
 COALESCE((SELECT SUM(public.canonical_supply_quantity(wsi.id,b.institute_id)) FROM public.warehouse_supply_items wsi WHERE wsi.requested_item_id=b.id),0) issued,
 CASE WHEN b.received_by=b.requester_id AND b.received_at IS NOT NULL AND NULLIF(trim(b.receipt_issue_status),'') IS NULL THEN GREATEST(COALESCE(b.received_quantity,0),0) ELSE 0 END acknowledged,
 COALESCE(t.inspection_pending,false) inspection_pending,
 EXISTS(SELECT 1 FROM po_lines l WHERE l.item_id=b.id AND (l.demand_factor IS NULL OR l.line_type='SERVICE')) unsupported,
 EXISTS(SELECT 1 FROM public.purchase_order_items pi JOIN public.purchase_orders p ON p.id=pi.purchase_order_id WHERE pi.requested_item_id=b.id AND (p.request_id<>b.request_id OR NOT EXISTS(SELECT 1 FROM public.suppliers s WHERE s.id=p.supplier_id AND (to_jsonb(s)?'institute_id' AND ((to_jsonb(s)->>'institute_id') IS NULL OR (to_jsonb(s)->>'institute_id')::integer=b.institute_id)))))
 OR EXISTS(SELECT 1 FROM public.goods_receipt_items gi JOIN public.purchase_order_items pi ON pi.id=gi.purchase_order_item_id JOIN public.goods_receipts gr ON gr.id=gi.goods_receipt_id JOIN public.purchase_orders p ON p.id=pi.purchase_order_id WHERE (pi.requested_item_id=b.id OR gi.requested_item_id=b.id) AND (pi.requested_item_id<>gi.requested_item_id OR gr.purchase_order_id<>p.id OR gr.request_id<>b.request_id OR p.request_id<>b.request_id OR (gi.warehouse_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.warehouses w WHERE w.id=gi.warehouse_id AND w.institute_id=b.institute_id)))) evidence_conflict,
 NULLIF(trim(b.receipt_issue_status),'') IS NOT NULL requester_issue
 FROM demand b LEFT JOIN receipt_totals t ON t.item_id=b.id
 UNION ALL
 SELECT wsi.id::bigint,wsi.requested_item_id::bigint,'warehouse_supply_item',wsi.quantity::numeric,NULL::text,
 lower(trim(COALESCE(to_jsonb(wsi)->>'approval_status','approved')))<>'rejected',true,
 0,0,0,0,0,0,public.canonical_supply_quantity(wsi.id,r.institute_id),0,false,false,false,false
 FROM root r JOIN public.warehouse_supply_items wsi ON wsi.request_id=r.id
 WHERE r.request_type='Warehouse Supply' AND (p_item_id IS NULL OR wsi.requested_item_id=p_item_id)
), quantified AS (
 SELECT f.*,LEAST(quantity,GREATEST(direct_accepted,0)+GREATEST(issued,LEAST(acknowledged,GREATEST(inventory_accepted,0)))) fulfilled,
 GREATEST(direct_accepted+inventory_accepted,0) accepted
 FROM item_facts f
), evaluated AS (
 SELECT q.*,eligible AND quantity>0 AND NOT unsupported AND NOT evidence_conflict AND NOT requester_issue AND fulfilled>=quantity fulfillment_complete,
 eligible AND quantity>0 AND NOT unsupported AND NOT evidence_conflict AND GREATEST(accepted,issued)>=quantity receipt_complete
 FROM quantified q
), summary AS (
 SELECT COUNT(*) FILTER(WHERE eligible)::int eligible_lines,
 COALESCE(BOOL_AND(fulfillment_complete) FILTER(WHERE eligible),false) all_fulfilled,
 COALESCE(BOOL_AND(receipt_complete) FILTER(WHERE eligible),false) all_received,
 COALESCE(BOOL_AND(ordered>=quantity OR stock_resolved) FILTER(WHERE eligible),false) all_procured,
 COALESCE(BOOL_AND(stock_resolved) FILTER(WHERE eligible),false) all_stock_resolved,
 COALESCE(BOOL_AND(acknowledged>=quantity AND NOT requester_issue) FILTER(WHERE eligible),false) all_acknowledged,
 COALESCE(BOOL_OR(fulfilled>0) FILTER(WHERE eligible),false) any_fulfilled,
 COALESCE(BOOL_OR(ordered>0) FILTER(WHERE eligible),false) any_ordered,
 COALESCE(BOOL_OR(unsupported OR evidence_conflict),false) evidence_gap,
 COALESCE(jsonb_agg(jsonb_build_object('line_kind',line_kind,'line_id',line_id::text,'requested_item_id',requested_item_id::text,'quantity',trim_scale(quantity)::text,'uom',uom,'eligible',eligible,'stock_resolved',stock_resolved,'ordered_quantity',trim_scale(ordered)::text,'delivered_quantity',trim_scale(delivered)::text,'accepted_quantity',trim_scale(accepted)::text,'rejected_quantity',trim_scale(rejected)::text,'quarantined_quantity',trim_scale(quarantined)::text,'warehouse_issued_quantity',trim_scale(issued)::text,'requester_acknowledged_quantity',trim_scale(acknowledged)::text,'fulfilled_quantity',trim_scale(fulfilled)::text,'fulfillment_complete',fulfillment_complete,'receipt_complete',receipt_complete,'inspection_pending',inspection_pending,'evidence_conflict',evidence_conflict,'unsupported_policy',unsupported,'requester_issue',requester_issue) ORDER BY line_kind,line_id),'[]'::jsonb) items
 FROM evaluated
), state AS (
 SELECT r.*,lower(trim(r.status)) IN ('rejected','cancelled','canceled','withdrawn') terminal,
 lower(trim(r.status)) IN ('approved','fully_approved','ready_for_procurement','assigned','partially procured','partially_procured','in progress','technical_inspection_pending','completed','received','closed','available in stock','available_in_stock')
 AND NOT EXISTS(SELECT 1 FROM public.approvals a WHERE a.request_id=r.id AND COALESCE((to_jsonb(a)->>'is_superseded')::boolean,false)=false AND lower(trim(a.status)) IN ('pending','on hold','hold') AND (COALESCE((to_jsonb(a)->>'is_active')::boolean,true) OR NOT (lower(trim(r.status)) IN ('available in stock','available_in_stock','completed','received','closed') AND (SELECT all_stock_resolved FROM summary)))) approved,
 (SELECT COUNT(*)::int FROM public.technical_inspections ti WHERE ti.request_id=r.id AND lower(COALESCE(ti.acceptance_status,'pending'))<>'passed') legacy_inspection_pending
 FROM root r
) SELECT jsonb_build_object('request_id',r.id::text,'institute_id',r.institute_id,'stored_status',r.status,'request_type',r.request_type,
 'approved_demand',r.approved,'terminal',r.terminal,'eligible_lines',s.eligible_lines,'procurement_started',s.any_ordered,'procurement_complete',s.eligible_lines>0 AND s.all_procured,
 'receipt_complete',s.eligible_lines>0 AND s.all_received,'stock_resolved',s.eligible_lines>0 AND s.all_stock_resolved,
 'partially_fulfilled',NOT r.terminal AND s.any_fulfilled AND NOT s.all_fulfilled,
 'fulfillment_complete',r.approved AND NOT r.terminal AND s.eligible_lines>0 AND s.all_fulfilled AND NOT s.evidence_gap,
 'requester_acknowledgment_complete',s.eligible_lines>0 AND s.all_acknowledged,
 'can_complete',r.approved AND NOT r.terminal AND lower(trim(r.status))<>'closed' AND s.eligible_lines>0 AND s.all_fulfilled AND NOT s.evidence_gap AND r.legacy_inspection_pending=0,
 'legacy_inspection_pending_count',r.legacy_inspection_pending,'evidence_gap',s.evidence_gap,
 'legacy_completion_without_fulfillment',lower(trim(r.status)) IN ('completed','received','closed') AND NOT s.all_fulfilled,'items',s.items)
 FROM state r CROSS JOIN summary s
$$;
REVOKE ALL ON FUNCTION public.canonical_supply_quantity(integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_procurement_completion(integer,integer,integer) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON FUNCTION public.canonical_supply_quantity(integer,integer), public.canonical_procurement_completion(integer,integer,integer) FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON FUNCTION public.canonical_supply_quantity(integer,integer), public.canonical_procurement_completion(integer,integer,integer) FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.canonical_supply_quantity(integer,integer), public.canonical_procurement_completion(integer,integer,integer) TO service_role;
 END IF;
END $$;
COMMIT;
