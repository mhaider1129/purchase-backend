'use strict';

const pool = require('../../../config/db');
const { aiError } = require('../aiErrors');

const schema = properties => ({type:'object',properties,additionalProperties:false});
const str={type:'string'}; const int={type:'integer',minimum:1};
const coverageColumns=['activity','complexity','commercial','cycle_time','logistics'];

function filters(input, context, alias='pc') {
  const params=[context.instituteIds]; const clauses=[`${alias}.institute_id = ANY($1::int[])`];
  const add=(value,sql) => { if(value!==undefined){params.push(value);clauses.push(sql.replace('?',`$${params.length}`));} };
  add(input.departmentId,`${alias}.department_id = ?`); add(input.buyerId,`${alias}.assigned_buyer_id = ?`);
  add(input.status,`${alias}.case_status = ?`); add(input.complexity,`${alias}.complexity_class = ?`);
  add(input.dateFrom,`${alias}.opened_at >= ?::date`); add(input.dateTo,`${alias}.opened_at < (?::date + interval '1 day')`);
  add(input.ageMin,`CURRENT_DATE-${alias}.opened_at::date >= ?`); add(input.ageMax,`CURRENT_DATE-${alias}.opened_at::date <= ?`);
  if(input.supplierId!==undefined){params.push(input.supplierId);clauses.push(`EXISTS (SELECT 1 FROM procurement_case_activities pca WHERE pca.procurement_case_id=${alias}.id AND pca.supplier_id=$${params.length})`);}
  return {params,where:clauses.join(' AND ')};
}
function coverage(rows) {
  const total=rows.length; const output={};
  for(const domain of coverageColumns){const counts={FULL:0,PARTIAL:0,MISSING:0,LEGACY_INCOMPLETE:0}; for(const row of rows) counts[row[`${domain}_coverage`]]=(counts[row[`${domain}_coverage`]]||0)+1; const usable=counts.FULL+counts.PARTIAL; output[domain]={coverage:total===0?'MISSING':counts.FULL===total?'FULL':usable?'PARTIAL':counts.LEGACY_INCOMPLETE?'LEGACY_INCOMPLETE':'MISSING',full_cases:counts.FULL,partial_cases:counts.PARTIAL,missing_cases:counts.MISSING,legacy_incomplete_cases:counts.LEGACY_INCOMPLETE,usable_evidence_cases:usable,total_cases:total,coverage_percent:total?(100*usable/total).toFixed(2):'0.00',full_coverage_percent:total?(100*counts.FULL/total).toFixed(2):'0.00'};}
  return output;
}

function createTools(database=pool) {
  return {
    get_request_summary:{description:'Get the authorized end-to-end summary for one purchase request.',parameters:{...schema({requestId:int}),required:['requestId']},async execute(input,ctx){
      const request=(await database.query(`SELECT r.*,d.name department_name,u.name requester_name FROM requests r LEFT JOIN departments d ON d.id=r.department_id LEFT JOIN users u ON u.id=r.requester_id WHERE r.id=$1 AND r.institute_id=ANY($2::int[])`,[input.requestId,ctx.instituteIds])).rows[0];
      if(!request) throw aiError(404,'AI_RECORD_NOT_FOUND','Request not found');
      const [items,approvals,lifecycle,rfx,awards,pos,receipts,assignment]=await Promise.all([
        database.query('SELECT id,item_name,quantity,unit_of_measure,approval_status,procurement_status,purchased_quantity,received_quantity,assigned_to,assigned_at FROM requested_items WHERE request_id=$1 ORDER BY id',[input.requestId]),
        database.query(`SELECT a.id,a.approval_level,a.status,a.is_active,a.comments,a.approved_at,a.decided_at,u.name approver_name FROM approvals a LEFT JOIN users u ON u.id=a.approver_id WHERE a.request_id=$1 ORDER BY a.approval_level,a.id`,[input.requestId]),
        database.query('SELECT * FROM procurement_lifecycle_states WHERE request_id=$1',[input.requestId]), database.query('SELECT id,title,rfx_type,due_date,status,created_at FROM rfx_events WHERE request_id=$1 ORDER BY created_at',[input.requestId]),
        database.query('SELECT id,request_item_id,supplier_id,awarded_quantity,unit_price,currency,source_type,awarded_at,status FROM procurement_awards WHERE request_id=$1 ORDER BY awarded_at',[input.requestId]),
        database.query('SELECT id,po_number,supplier_id,status,currency,total_amount,expected_delivery_date,issued_at FROM purchase_orders WHERE request_id=$1 ORDER BY created_at',[input.requestId]),
        database.query('SELECT id,receipt_number,purchase_order_id,received_at,discrepancy_notes FROM goods_receipts WHERE request_id=$1 ORDER BY received_at',[input.requestId]),
        database.query('SELECT id,requested_item_id,assigned_buyer_id,case_status,opened_at,closed_at FROM procurement_cases WHERE request_id=$1 AND institute_id=ANY($2::int[]) ORDER BY id',[input.requestId,ctx.instituteIds])]);
      return {data:{request,requesting_department:request.department_name,requester:request.requester_name,request_type:request.request_type,requested_items:items.rows,current_status:request.status,approval_status:approvals.rows.find(row=>row.is_active)?.status || request.status,approval_history:approvals.rows,procurement_assignment:assignment.rows,procurement_lifecycle:lifecycle.rows[0] || null,linked_rfx:rfx.rows,awards:awards.rows,purchase_orders:pos.rows,receipt_status:receipts.rows},sources:[{type:'request',id:request.id,label:`PR-${request.id}`}],recordCount:1};
    }},
    get_pending_approvals:{description:'List pending approvals assigned to the authenticated user.',parameters:schema({departmentId:int,requestType:str,ageDays:int,limit:int}),async execute(input,ctx){
      const params=[ctx.userId,ctx.instituteIds]; let where=`a.approver_id=$1 AND a.status='Pending' AND a.is_active=true AND r.institute_id=ANY($2::int[])`;
      const add=(v,s)=>{if(v!==undefined){params.push(v);where+=` AND ${s.replace('?',`$${params.length}`)}`;}}; add(input.departmentId,'r.department_id=?');add(input.requestType,'r.request_type=?');add(input.ageDays,'CURRENT_DATE-r.created_at::date>=?');params.push(input.limit);
      const rows=(await database.query(`SELECT a.id approval_id,a.request_id,a.approval_level,r.request_type,r.department_id,r.created_at,EXTRACT(day FROM NOW()-r.created_at)::int age_days FROM approvals a JOIN requests r ON r.id=a.request_id WHERE ${where} ORDER BY r.created_at LIMIT $${params.length}`,params)).rows;
      return {data:rows,sources:rows.map(r=>({type:'request',id:r.request_id,label:`PR-${r.request_id}`})),recordCount:rows.length};
    }},
    get_procurement_cases:{description:'List authorized procurement cases with their evidence coverage.',parameters:schema({status:str,departmentId:int,buyerId:int,supplierId:int,complexity:str,ageMin:int,ageMax:int,dateFrom:str,dateTo:str,limit:int}),async execute(input,ctx){
      const scoped=filters(input,ctx);scoped.params.push(input.limit);const rows=(await database.query(`SELECT pc.*,ri.item_name,r.request_type FROM procurement_cases pc JOIN requested_items ri ON ri.id=pc.requested_item_id JOIN requests r ON r.id=pc.request_id WHERE ${scoped.where} ORDER BY pc.opened_at DESC LIMIT $${scoped.params.length}`,scoped.params)).rows;
      return {data:rows,coverage:coverage(rows),sources:rows.map(r=>({type:'procurement_case',id:r.id,label:`Case ${r.id}`})),recordCount:rows.length};
    }},
    get_supplier_summary:{description:'Get supplier evidence connected to transactions in the authorized institute scope.',parameters:{...schema({supplierId:int}),required:['supplierId']},async execute(input,ctx){
      const visible=await database.query(`SELECT 1 FROM procurement_cases pc WHERE pc.institute_id=ANY($1::int[]) AND (EXISTS(SELECT 1 FROM procurement_case_activities a WHERE a.procurement_case_id=pc.id AND a.supplier_id=$2) OR EXISTS(SELECT 1 FROM procurement_awards pa WHERE pa.request_item_id=pc.requested_item_id AND pa.supplier_id=$2) OR EXISTS(SELECT 1 FROM purchase_order_items poi JOIN purchase_orders po ON po.id=poi.purchase_order_id WHERE poi.request_item_id=pc.requested_item_id AND po.supplier_id=$2)) LIMIT 1`,[ctx.instituteIds,input.supplierId]);
      if(!visible.rowCount) throw aiError(404,'AI_RECORD_NOT_FOUND','Supplier not found in your authorized data scope');
      const supplier=(await database.query('SELECT id,name,supplier_type,status,country,currency,payment_terms,lead_time_days,regulatory_risk_level,supplier_category,created_at FROM suppliers WHERE id=$1',[input.supplierId])).rows[0];
      if(!supplier) throw aiError(404,'AI_RECORD_NOT_FOUND','Supplier not found');
      const scopeParams=[input.supplierId,ctx.instituteIds];
      const [rfx,awards,pos,deliveries,evaluations,scorecards,issues,compliance,mismatches,contracts]=await Promise.all([
        database.query(`SELECT rr.id response_id,rr.rfx_id,rr.bid_amount,rr.status,rr.created_at FROM rfx_responses rr JOIN requests r ON r.id=rr.request_id WHERE rr.supplier_id=$1 AND r.institute_id=ANY($2::int[]) ORDER BY rr.created_at DESC`,scopeParams),
        database.query(`SELECT pa.id,pa.request_id,pa.request_item_id,pa.awarded_quantity,pa.unit_price,pa.currency,pa.awarded_at,pa.status FROM procurement_awards pa JOIN requests r ON r.id=pa.request_id WHERE pa.supplier_id=$1 AND r.institute_id=ANY($2::int[])`,scopeParams),
        database.query(`SELECT po.id,po.po_number,po.status,po.currency,po.total_amount,po.expected_delivery_date,po.issued_at FROM purchase_orders po JOIN requests r ON r.id=po.request_id WHERE po.supplier_id=$1 AND r.institute_id=ANY($2::int[])`,scopeParams),
        database.query(`SELECT gr.id,gr.purchase_order_id,gr.received_at,gr.discrepancy_notes FROM goods_receipts gr JOIN purchase_orders po ON po.id=gr.purchase_order_id JOIN requests r ON r.id=po.request_id WHERE po.supplier_id=$1 AND r.institute_id=ANY($2::int[])`,scopeParams),
        database.query('SELECT id,evaluation_date,quality_score,delivery_score,cost_score,compliance_score,overall_score FROM supplier_evaluations WHERE supplier_id=$1 ORDER BY evaluation_date DESC',[input.supplierId]),
        database.query('SELECT id,period_start,period_end,otif_score,quality_defects,lead_time_variance FROM supplier_scorecards WHERE supplier_id=$1 ORDER BY period_end DESC',[input.supplierId]),
        database.query('SELECT id,description,severity,status,capa_required,due_date,resolved_at FROM supplier_issues WHERE supplier_id=$1 ORDER BY created_at DESC',[input.supplierId]),
        database.query('SELECT id,artifact_type,name,expiry_date,status,blocked FROM supplier_compliance_artifacts WHERE supplier_id=$1 ORDER BY expiry_date',[input.supplierId]),
        database.query(`SELECT imr.id,imr.match_status,imr.mismatch_reasons,imr.matched_at FROM invoice_match_results imr JOIN supplier_invoices si ON si.id=imr.supplier_invoice_id JOIN requests r ON r.id=si.request_id WHERE si.supplier_id=$1 AND r.institute_id=ANY($2::int[]) AND imr.match_status NOT IN ('MATCHED','PASSED')`,scopeParams),
        database.query(`SELECT c.id,c.title,c.status,c.start_date,c.end_date FROM contracts c JOIN requests r ON r.id=c.source_request_id WHERE c.supplier_id=$1 AND r.institute_id=ANY($2::int[])`,scopeParams)]);
      return {data:{supplier,rfx_participation:rfx.rows,quotations:rfx.rows,awards:awards.rows,purchase_order_history:pos.rows,delivery_history:deliveries.rows,supplier_evaluations:evaluations.rows,srm:{scorecards:scorecards.rows,issues:issues.rows,compliance:compliance.rows},invoice_mismatches:mismatches.rows,contracts:contracts.rows},warnings:['Supplier evaluation and SRM records are supplier-scoped; their schema has no institute identifier. Access is gated by scoped transactional evidence.'],sources:[{type:'supplier',id:supplier.id,label:supplier.name}],recordCount:1};
    }},
    get_supply_chain_kpis:{description:'Get authorized supply-chain KPIs with explicit evidence coverage and currency separation.',parameters:{...schema({dateFrom:str,dateTo:str,departmentId:int,buyerId:int}),required:['dateFrom','dateTo']},async execute(input,ctx){
      const scoped=filters(input,ctx);const rows=(await database.query(`SELECT pc.* FROM procurement_cases pc WHERE ${scoped.where}`,scoped.params)).rows; const ids=rows.map(r=>r.id); const requestIds=[...new Set(rows.map(r=>r.request_id))]; const cov=coverage(rows);
      const [base,pipeline,values,activity]=await Promise.all([
        ids.length?database.query(`SELECT count(DISTINCT pc.request_id)::int pr_count,count(DISTINCT pc.requested_item_id)::int requested_item_count,count(DISTINCT pc.department_id)::int departments_served FROM procurement_cases pc WHERE pc.id=ANY($1::bigint[])`,[ids]):{rows:[{pr_count:0,requested_item_count:0,departments_served:0}]},
        ids.length?database.query('SELECT case_status,count(*)::int count FROM procurement_cases WHERE id=ANY($1::bigint[]) GROUP BY case_status',[ids]):{rows:[]},
        ids.length?database.query(`SELECT value_type,currency,sum(verified_value)::text value FROM procurement_value_events WHERE procurement_case_id=ANY($1::bigint[]) GROUP BY value_type,currency ORDER BY value_type,currency`,[ids]):{rows:[]},
        ids.length?database.query(`SELECT count(*) FILTER(WHERE activity_type='RFQ_CREATED')::int rfqs,count(*) FILTER(WHERE activity_type='QUOTATION_RECEIVED')::int quotations FROM procurement_case_activities a JOIN procurement_cases pc ON pc.id=a.procurement_case_id WHERE pc.id=ANY($1::bigint[]) AND pc.activity_coverage IN('FULL','PARTIAL')`,[ids]):{rows:[{rfqs:null,quotations:null}]}
      ]);
      const usable=cov.activity.usable_evidence_cases>0;
      return {data:{...base.rows[0],procurement_case_count:rows.length,pipeline_distribution:pipeline.rows,completed_delivered_count:rows.filter(r=>['DELIVERED','CLOSED'].includes(r.case_status)).length,pending_count:rows.filter(r=>!['DELIVERED','CLOSED'].includes(r.case_status)).length,complexity_distribution:Object.entries(rows.reduce((a,r)=>{if(r.complexity_class)a[r.complexity_class]=(a[r.complexity_class]||0)+1;return a;},{})).map(([className,count])=>({class:className,count})),buyer_workload:Object.values(rows.reduce((a,r)=>{const key=r.assigned_buyer_id || 'unassigned';a[key] ||= {buyer_id:r.assigned_buyer_id,count:0,pwu:0};a[key].count++;a[key].pwu+=r.workload_units || 0;return a;},{})),rfqs:usable?activity.rows[0].rfqs:null,quotations:usable?activity.rows[0].quotations:null,values_by_currency:values.rows,median_approval_time:null,median_sourcing_time:null,po_processing_time:null},coverage:cov,warnings:[...(!usable?['RFQ and quotation counts are unavailable because no case has usable activity evidence.']:[]),'Cycle-time metrics are unavailable in this foundation rather than represented as zero.'],sources:requestIds.map(id=>({type:'request',id,label:`PR-${id}`})),recordCount:rows.length};
    }},
    get_attention_items:{description:'Find deterministic operational exceptions and return their evidence and reason codes.',parameters:schema({dateFrom:str,dateTo:str,departmentId:int,buyerId:int,limit:int}),async execute(input,ctx){
      const scoped=filters(input,ctx);scoped.params.push(input.limit);const rows=(await database.query(`SELECT pc.id,pc.request_id,pc.requested_item_id,pc.assigned_buyer_id,pc.case_status,pc.opened_at,pc.pending_root_cause,pc.commercial_coverage,pc.logistics_coverage,CASE WHEN pc.case_status='APPROVAL_PENDING' AND NOW()-pc.opened_at>interval '7 days' THEN 'LONG_PENDING_APPROVAL' WHEN pc.case_status='AWAITING_QUOTATION' AND NOW()-pc.opened_at>interval '14 days' THEN 'AWAITING_SUPPLIER_RESPONSE' WHEN pc.commercial_coverage IN('MISSING','LEGACY_INCOMPLETE') AND pc.case_status IN('COMMERCIAL_EVALUATION','AWARDED','PO_PROCESSING') THEN 'INCOMPLETE_COMMERCIAL_EVIDENCE' WHEN pc.closed_at IS NULL AND NOW()-pc.opened_at>interval '30 days' THEN 'AGING_PROCUREMENT_CASE' END reason_code FROM procurement_cases pc WHERE ${scoped.where} AND ((pc.case_status='APPROVAL_PENDING' AND NOW()-pc.opened_at>interval '7 days') OR (pc.case_status='AWAITING_QUOTATION' AND NOW()-pc.opened_at>interval '14 days') OR (pc.commercial_coverage IN('MISSING','LEGACY_INCOMPLETE') AND pc.case_status IN('COMMERCIAL_EVALUATION','AWARDED','PO_PROCESSING')) OR (pc.closed_at IS NULL AND NOW()-pc.opened_at>interval '30 days')) ORDER BY pc.opened_at LIMIT $${scoped.params.length}`,scoped.params)).rows;
      return {data:rows.map(row=>({...row,evidence:{opened_at:row.opened_at,case_status:row.case_status,pending_root_cause:row.pending_root_cause,commercial_coverage:row.commercial_coverage}})),warnings:['Only deterministic rules backed by procurement-case evidence are included. Shipment and contract warnings are omitted where authoritative linkage is unavailable.'],sources:rows.map(r=>({type:'procurement_case',id:r.id,label:`Case ${r.id}`})),recordCount:rows.length};
    }},
  };
}

module.exports={createTools,coverage};