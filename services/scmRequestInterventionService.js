'use strict';
const pool = require('../config/db');
const failure = require('../utils/httpError');
const { userHasPermission } = require('../utils/permissionService');
const normalizeRoleKey = role => String(role || '').trim().toLowerCase();
const { writeAuditEvent } = require('./auditService');

const ACTION = 'SCM Intervention Rejected';
const PRE_APPROVAL = new Set(['submitted', 'pending', 'on hold', 'scheduled', 'pending approval', 'pending requester approval']);
const canIntervene = (actor, request) => normalizeRoleKey(actor?.role) === 'scm'
  && userHasPermission(actor, 'requests.manage') && Number(actor?.institute_id) > 0
  && Number(request?.institute_id) === Number(actor.institute_id)
  && PRE_APPROVAL.has(String(request?.status || '').trim().toLowerCase());

function createScmRequestInterventionService(database = pool) {
  return async ({ requestId, reason, actor }) => {
    if (!actor?.id || normalizeRoleKey(actor.role) !== 'scm' || !userHasPermission(actor, 'requests.manage') || !(Number(actor.institute_id) > 0)) {
      throw failure(403, 'SCM authority, requests.manage and an institute context are required');
    }
    if (!/^\d+$/.test(String(requestId)) || !Number.isSafeInteger(Number(requestId)) || Number(requestId) < 1 || Number(requestId) > 2147483647) throw failure(400, 'Invalid request ID');
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 2000) throw failure(400, 'A rejection reason from 1 to 2000 characters is required');
    reason = reason.trim();
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const request = (await client.query('SELECT * FROM requests WHERE id=$1 AND institute_id=$2 FOR UPDATE', [requestId, actor.institute_id])).rows[0];
      if (!request) throw failure(404, 'Request not found in your institute');
      if (String(request.status).trim().toLowerCase() === 'rejected') {
        const prior = await client.query('SELECT id FROM request_logs WHERE request_id=$1 AND action=$2 AND actor_id=$3 AND comments=$4 LIMIT 1', [requestId, ACTION, actor.id, reason]);
        if (!prior.rows.length) throw failure(409, 'Request has already been rejected');
        await client.query('COMMIT');
        return { request_id: Number(requestId), status: 'Rejected', replayed: true };
      }
      if (!canIntervene(actor, request) || request.completed_at || request.purchase_order_id || request.purchase_order_number || request.awarded_at || request.po_issued_at) throw failure(409, 'SCM intervention is available only before final approval and procurement');
      // Lock the demand lines as well as the request so a competing procurement write cannot slip through.
      const items = await client.query('SELECT id,purchased_quantity FROM requested_items WHERE request_id=$1 ORDER BY id FOR UPDATE', [requestId]);
      if (items.rows.some(item => Number(item.purchased_quantity || 0) > 0)) throw failure(409, 'Procurement has already started; use the governed cancellation process');
      const downstream = await client.query(`SELECT EXISTS(SELECT 1 FROM purchase_orders WHERE request_id=$1)
        OR EXISTS(SELECT 1 FROM procurement_item_events WHERE request_id=$1)
        OR EXISTS(SELECT 1 FROM rfx_events WHERE request_id=$1)
        OR EXISTS(SELECT 1 FROM goods_receipts WHERE request_id=$1)
        OR EXISTS(SELECT 1 FROM contracts WHERE source_request_id=$1)
        OR EXISTS(SELECT 1 FROM requested_item_financials WHERE request_id=$1 AND (COALESCE(committed_cost,0)>0 OR COALESCE(paid_cost,0)>0 OR NULLIF(TRIM(po_number),'') IS NOT NULL OR NULLIF(TRIM(invoice_number),'') IS NOT NULL))
        OR EXISTS(SELECT 1 FROM warehouse_supplied_items WHERE request_id=$1) AS started`, [requestId]);
      if (downstream.rows[0]?.started) throw failure(409, 'Procurement documents already exist; use their governed cancellation process');
      const approvals = await client.query("SELECT id,approver_id,is_active,status FROM approvals WHERE request_id=$1 AND status IN ('Pending','On Hold') AND NOT COALESCE(is_superseded,FALSE) ORDER BY id FOR UPDATE", [requestId]);
      if (!approvals.rows.length) throw failure(409, 'No pending approval workflow remains to stop');
      await client.query("UPDATE requests SET status='Rejected',updated_at=NOW() WHERE id=$1", [requestId]);
      const stoppedIds = approvals.rows.map(approval => approval.id);
      await client.query(`UPDATE approvals SET status='Superseded',is_active=FALSE,is_superseded=TRUE,
        superseded_at=NOW(),superseded_by_user_id=$2,superseded_reason=$3,updated_at=NOW() WHERE id=ANY($1::integer[])`, [stoppedIds, actor.id, `SCM intervention: ${reason}`]);
      await client.query('INSERT INTO request_logs(request_id,action,actor_id,comments) VALUES($1,$2,$3,$4)', [requestId, ACTION, actor.id, reason]);
      await client.query(`INSERT INTO approval_logs(approval_id,request_id,approver_id,action,comments)
        SELECT id,request_id,$2,'Stopped by SCM intervention',$3 FROM approvals WHERE id=ANY($1::integer[])`, [stoppedIds, actor.id, reason]);
      await writeAuditEvent({ client, entityType: 'request', entityId: requestId, requestId, instituteId: actor.institute_id,
        action: 'request.scm_early_rejected', actorUserId: actor.id, reason,
        beforeData: { status: request.status, pending_approvals: approvals.rows },
        afterData: { status: 'Rejected', stopped_approval_ids: stoppedIds } });
      const recipients = [...new Set([request.requester_id, request.initiated_by_technician_id, ...approvals.rows.filter(row => row.is_active).map(row => row.approver_id)].filter(Boolean).map(Number))];
      for (const recipient of recipients) await client.query(`INSERT INTO notifications(user_id,title,message,link,metadata)
        VALUES($1,'Request stopped by SCM',$2,$3,$4::jsonb)`, [recipient, `${actor.name || 'SCM'} rejected request ${requestId} before final approval. Reason: ${reason}`, `/requests/${requestId}`, JSON.stringify({ action: 'scm_early_rejection', requestId: Number(requestId), actorId: actor.id })]);
      await client.query('COMMIT');
      return { request_id: Number(requestId), status: 'Rejected', stopped_approval_ids: stoppedIds, replayed: false };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  };
}
module.exports = { createScmRequestInterventionService, canIntervene };
