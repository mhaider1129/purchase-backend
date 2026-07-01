
const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');
const { ensureRequestedItemFinancialsTable } = require('../../utils/ensureRequestedItemFinancialsTable');
const ensureRequestedItemApprovalColumns = require('../../utils/ensureRequestedItemApprovalColumns');
const ensureRequestedItemReceivedColumns = require('../../utils/ensureRequestedItemReceivedColumns');
const { ensureRequestedItemAssignmentColumns } = require('./assignRequestController');

const PRIVILEGED_ROLES = new Set(['admin', 'scm', 'procurementsupervisor', 'procurement supervisor']);
const PROCUREMENT_ROLES = new Set(['scm', 'procurementsupervisor', 'procurement supervisor', 'procurementspecialist', 'procurement specialist', 'procurementmanager', 'procurement manager']);
const APPROVER_ROLES = new Set(['hod', 'cmo', 'coo', 'ceo', 'finance', 'approver']);

const normalize = (value) => String(value || '').trim().toLowerCase();
const isPositiveId = (value) => Number.isInteger(Number(value)) && Number(value) > 0;
const hasPermission = (user, permission) => typeof user?.hasPermission === 'function' && user.hasPermission(permission);

const tableExists = async (tableName) => {
  const { rows } = await pool.query(`SELECT to_regclass($1) AS table_name`, [`public.${tableName}`]);
  return Boolean(rows[0]?.table_name);
};

const safeQuery = async (tableName, query, values = []) => {
  if (!(await tableExists(tableName))) return [];
  const { rows } = await pool.query(query, values);
  return rows;
};

const parseAuditDetails = (details) => {
  if (!details || typeof details !== 'string') return details || null;
  try {
    return JSON.parse(details);
  } catch (_err) {
    return details;
  }
};

const checkWorkspaceAccess = async (requestId, user) => {
  const role = normalize(user?.role);
  const isPrivileged = hasPermission(user, 'requests.view-all') || hasPermission(user, 'requests.manage') || PRIVILEGED_ROLES.has(role);

  const values = [requestId];
  let predicate = 'TRUE';

  if (!isPrivileged) {
    values.push(user.id);
    const userParam = `$${values.length}`;
    values.push(user.department_id || null);
    const departmentParam = `$${values.length}`;
    predicate = `(
      r.requester_id = ${userParam}
      OR r.assigned_to = ${userParam}
      OR r.department_id = ${departmentParam}
      OR EXISTS (SELECT 1 FROM approvals a WHERE a.request_id = r.id AND a.approver_id = ${userParam})
      OR EXISTS (SELECT 1 FROM public.requested_items ri_access WHERE ri_access.request_id = r.id AND ri_access.assigned_to = ${userParam})
    )`;
  }

  const { rows } = await pool.query(
    `SELECT r.*,
            d.name AS department_name,
            s.name AS section_name,
            COALESCE(r.temporary_requester_name, requester.name) AS requester_name,
            requester.role AS requester_role,
            assigned.name AS assigned_to_name,
            assigned.role AS assigned_to_role
     FROM requests r
     LEFT JOIN departments d ON d.id = r.department_id
     LEFT JOIN sections s ON s.id = r.section_id
     LEFT JOIN users requester ON requester.id = r.requester_id
     LEFT JOIN users assigned ON assigned.id = r.assigned_to
     WHERE r.id = $1 AND ${predicate}
     LIMIT 1`,
    values,
  );

  if (rows.length === 0) return null;
  return rows[0];
};

const buildRequestSummary = (request, approvals, items) => {
  const activeApproval = approvals.find((approval) => approval.is_active && normalize(approval.status) === 'pending');
  const pendingApprovals = approvals.filter((approval) => normalize(approval.status) === 'pending');
  const remainingTotal = items.reduce((sum, item) => sum + Number(item.remaining_quantity || 0), 0);
  const procurementStatus = remainingTotal <= 0 && items.length > 0 ? 'completed' : items.some((item) => Number(item.purchased_quantity || 0) > 0) ? 'partially_procured' : request.status;

  let currentBottleneck = 'Request review';
  let nextRequiredAction = 'Review request status';

  if (activeApproval) {
    currentBottleneck = `Approval level ${activeApproval.approval_level}`;
    nextRequiredAction = `Awaiting ${activeApproval.approver_name || 'approver'} approval`;
  } else if (!request.assigned_to) {
    currentBottleneck = 'Procurement assignment';
    nextRequiredAction = 'Assign request to procurement';
  } else if (remainingTotal > 0) {
    currentBottleneck = 'Procurement execution';
    nextRequiredAction = 'Register procurement progress';
  } else {
    currentBottleneck = 'Completion';
    nextRequiredAction = 'Mark request completed/received if required';
  }

  return {
    request_id: request.id,
    id: request.id,
    request_number: request.request_number || request.request_code || request.maintenance_ref_number || request.id,
    request_code: request.request_code || request.maintenance_ref_number || null,
    request_type: request.request_type,
    request_status: request.status,
    status: request.status,
    approval_status: pendingApprovals.length > 0 ? 'Pending' : approvals.some((approval) => normalize(approval.status) === 'rejected') ? 'Rejected' : 'Approved',
    procurement_status: procurementStatus,
    department_id: request.department_id,
    department_name: request.department_name,
    section_id: request.section_id,
    section_name: request.section_name,
    requester_id: request.requester_id,
    requester_name: request.requester_name,
    created_at: request.created_at,
    updated_at: request.updated_at,
    justification: request.justification,
    intended_use: items.find((item) => item.intended_use)?.intended_use || null,
    estimated_cost: request.estimated_cost,
    priority: request.priority || (request.is_urgent ? 'Urgent' : 'Normal'),
    emergency_flag: Boolean(request.is_urgent || request.emergency_flag),
    required_delivery_date: request.required_delivery_date || request.scheduled_for || null,
    assigned_to_id: request.assigned_to,
    assigned_to_name: request.assigned_to_name,
    current_bottleneck: currentBottleneck,
    next_required_action: nextRequiredAction,
  };
};

const getApprovals = async (requestId) => safeQuery(
  'approvals',
  `SELECT a.id AS approval_id,
          a.approval_level,
          a.approver_id,
          u.name AS approver_name,
          u.role AS approver_role,
          a.status,
          a.is_active,
          a.approved_at,
          a.comments,
          ROUND(EXTRACT(EPOCH FROM (COALESCE(a.approved_at, NOW()) - COALESCE(a.updated_at, a.approved_at, NOW()))) / 3600.0, 2) AS waiting_time_hours
   FROM approvals a
   LEFT JOIN users u ON u.id = a.approver_id
   WHERE a.request_id = $1
   ORDER BY a.approval_level ASC, a.id ASC`,
  [requestId],
);

const getItems = async (requestId) => {
  await ensureRequestedItemApprovalColumns();
  await ensureRequestedItemReceivedColumns();
  await ensureRequestedItemAssignmentColumns();
  await ensureRequestedItemFinancialsTable();
  const hasProcurementEvents = await tableExists('procurement_item_events');
  const hasContracts = await tableExists('contracts');

  return safeQuery(
    'requested_items',
    `SELECT ri.id AS item_id,
            ri.id,
            ri.item_name,
            ri.brand,
            NULL::text AS category,
            NULL::text AS sub_category,
            ri.quantity AS requested_quantity,
            COALESCE(ri.purchased_quantity, 0) AS purchased_quantity,
            GREATEST(ri.quantity - COALESCE(ri.purchased_quantity, 0), 0) AS remaining_quantity,
            ri.unit_cost,
            ri.total_cost,
            ri.available_quantity,
            ri.procurement_status,
            ri.specs,
            ri.intended_use,
            COALESCE(ri.procurement_updated_at, pie.latest_procurement_update) AS last_procurement_update,
            COALESCE(pie.procurement_events_count, 0)::int AS procurement_events_count,
            COALESCE(pie.latest_note, ri.procurement_comment) AS latest_note,
            ri.assigned_to,
            assigned.name AS assigned_to_name,
            rif.contract_id,
            ${hasContracts ? 'c.vendor' : 'NULL::text'} AS supplier_name,
            ${hasContracts ? 'c.supplier_id' : 'NULL::integer'} AS supplier_id
     FROM public.requested_items ri
     LEFT JOIN public.requested_item_financials rif ON rif.requested_item_id = ri.id
     ${hasContracts ? 'LEFT JOIN contracts c ON c.id = rif.contract_id' : ''}
     LEFT JOIN users assigned ON assigned.id = ri.assigned_to
     LEFT JOIN LATERAL (
       ${hasProcurementEvents ? `SELECT COUNT(*)::int AS procurement_events_count,
              MAX(COALESCE(procurement_date::timestamp, created_at)) AS latest_procurement_update,
              (ARRAY_AGG(procurement_note ORDER BY created_at DESC, id DESC))[1] AS latest_note
       FROM public.procurement_item_events pie
       WHERE pie.requested_item_id = ri.id` : `SELECT 0::int AS procurement_events_count, NULL::timestamp AS latest_procurement_update, NULL::text AS latest_note`}
     ) pie ON TRUE
     WHERE ri.request_id = $1
     ORDER BY ri.id ASC`,
    [requestId],
  );
};

const getProcurementEvents = async (requestId) => safeQuery(
  'procurement_item_events',
  `SELECT pie.id AS event_id,
          pie.requested_item_id,
          ri.item_name,
          pie.event_quantity,
          pie.previous_purchased_quantity,
          pie.new_purchased_quantity,
          pie.remaining_quantity,
          pie.unit_cost,
          pie.total_cost,
          COALESCE(s.name, pie.supplier_name) AS supplier_name,
          u.name AS procurement_user_name,
          pie.procurement_date,
          pie.procurement_note AS note,
          pie.created_at
   FROM public.procurement_item_events pie
   LEFT JOIN public.requested_items ri ON ri.id = pie.requested_item_id
   LEFT JOIN suppliers s ON s.id = pie.supplier_id
   LEFT JOIN users u ON u.id = pie.procurement_user_id
   WHERE pie.request_id = $1
   ORDER BY pie.procurement_date ASC, pie.created_at ASC, pie.id ASC`,
  [requestId],
);

const getLinkedRecords = async (requestId) => {
  const [rfqs, quotations, purchaseOrders, grns, inspections, invoices, contracts] = await Promise.all([
    safeQuery('rfx_events', `SELECT id, title, rfx_type, status, due_date, created_at, updated_at FROM rfx_events WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]),
    safeQuery('rfx_responses', `SELECT rr.id, rr.rfx_id, rr.bid_amount, rr.status, rr.created_at, s.name AS supplier_name FROM rfx_responses rr LEFT JOIN suppliers s ON s.id = rr.supplier_id WHERE rr.request_id = $1 ORDER BY rr.created_at DESC`, [requestId]),
    safeQuery('purchase_orders', `SELECT po.id, po.po_number, po.status, po.total_amount, po.currency, po.supplier_name, po.created_at, po.updated_at FROM purchase_orders po WHERE po.request_id = $1 ORDER BY po.created_at DESC`, [requestId]),
    safeQuery('goods_receipts', `SELECT gr.id, gr.receipt_number, gr.received_at, gr.notes, gr.discrepancy_notes, gr.created_at, u.name AS received_by_name FROM goods_receipts gr LEFT JOIN users u ON u.id = gr.received_by WHERE gr.request_id = $1 ORDER BY gr.created_at DESC`, [requestId]),
    safeQuery('technical_inspections', `SELECT id, item_name, supplier_name, inspection_date, acceptance_status, acceptance_notes, created_at FROM technical_inspections WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]),
    safeQuery('supplier_invoices', `SELECT si.id, si.invoice_number, si.supplier, si.total_amount, si.currency, si.submitted_at, si.purchase_order_id FROM supplier_invoices si WHERE si.request_id = $1 ORDER BY si.submitted_at DESC`, [requestId]),
    safeQuery('contracts', `SELECT id, title, vendor, reference_number, contract_value, status, start_date, end_date, created_at FROM contracts WHERE source_request_id = $1 ORDER BY created_at DESC`, [requestId]),
  ]);

  return { rfqs, quotations, purchase_orders: purchaseOrders, grns, inspections, invoices, payments: [], contracts };
};

const getAttachments = async (requestId) => safeQuery(
  'attachments',
  `SELECT a.id, a.request_id, a.item_id, a.contract_id, a.file_name, a.file_path, a.uploaded_at, u.name AS uploaded_by_name,
          CASE WHEN a.item_id IS NOT NULL THEN 'item' WHEN a.contract_id IS NOT NULL THEN 'contract' ELSE 'request' END AS source_type
   FROM attachments a
   LEFT JOIN users u ON u.id = a.uploaded_by
   WHERE a.request_id = $1 OR a.item_id IN (SELECT id FROM requested_items WHERE request_id = $1)
   ORDER BY a.uploaded_at DESC, a.id DESC`,
  [requestId],
);

const getCommunicationNotes = async (requestId) => safeQuery(
  'request_logs',
  `SELECT rl.id AS log_id,
          rl.id AS note_id,
          u.name AS actor_name,
          rl.action,
          rl.comments,
          COALESCE(rl.timestamp, NOW()) AS created_at,
          COALESCE(NULLIF(rl.action, ''), 'request_log') AS note_type
   FROM request_logs rl
   LEFT JOIN users u ON u.id = rl.actor_id
   WHERE rl.request_id = $1
   ORDER BY rl.timestamp DESC, rl.id DESC`,
  [requestId],
);

const getAuditLogs = async (requestId) => safeQuery(
  'audit_logs',
  `SELECT al.id,
          COALESCE(al.action_type, al.action) AS action,
          COALESCE(actor.name, usr.name) AS actor_name,
          al.target_type,
          al.target_id,
          al.description,
          al.details,
          al.created_at
   FROM audit_logs al
   LEFT JOIN users actor ON actor.id = al.actor_id
   LEFT JOIN users usr ON usr.id = al.user_id
   WHERE (LOWER(COALESCE(al.target_type, '')) IN ('request', 'requests', 'purchase_request') AND al.target_id = $1)
      OR al.description ILIKE $2
      OR al.details::text ILIKE $2
   ORDER BY al.created_at DESC, al.id DESC`,
  [requestId, `%${requestId}%`],
).then((rows) => rows.map((row) => ({ ...row, details: parseAuditDetails(row.details), before_values: row.before_values || null, after_values: row.after_values || null })));

const timelineEvent = ({ id, event_type, title, description, actor_name, event_time, status, linked_record_type, linked_record_id }) => ({
  id: String(id),
  event_type,
  title,
  description: description || '',
  actor_name: actor_name || null,
  event_time,
  status: status || null,
  linked_record_type,
  linked_record_id,
});

const buildTimeline = (request, approvals, procurementEvents, linkedRecords, attachments, communicationNotes, auditLogs) => {
  const events = [];
  if (request.created_at) {
    events.push(timelineEvent({
      id: `request-${request.id}`,
      event_type: 'request',
      title: 'Request created',
      description: request.justification,
      actor_name: request.requester_name,
      event_time: request.created_at,
      status: request.status,
      linked_record_type: 'request',
      linked_record_id: request.id,
    }));
  }

  approvals.forEach((approval) => events.push(timelineEvent({
    id: `approval-${approval.approval_id}`,
    event_type: 'approval',
    title: `${approval.status || 'Approval'} by ${approval.approver_role || approval.approver_name || 'approver'}`,
    description: approval.comments,
    actor_name: approval.approver_name,
    event_time: approval.approved_at || request.created_at,
    status: approval.status,
    linked_record_type: 'approval',
    linked_record_id: approval.approval_id,
  })));

  procurementEvents.forEach((event) => events.push(timelineEvent({
    id: `procurement-${event.event_id}`,
    event_type: 'procurement',
    title: `Procured ${event.event_quantity} ${event.item_name || ''}`.trim(),
    description: event.note,
    actor_name: event.procurement_user_name,
    event_time: event.created_at || event.procurement_date,
    status: event.remaining_quantity > 0 ? 'Partially Procured' : 'Purchased',
    linked_record_type: 'procurement_event',
    linked_record_id: event.event_id,
  })));

  const linkedTimelineMap = [
    ['rfqs', 'RFQ', 'rfq', 'created_at'],
    ['quotations', 'Quotation', 'quotation', 'created_at'],
    ['purchase_orders', 'Purchase order', 'po', 'created_at'],
    ['grns', 'Goods receipt', 'grn', 'created_at'],
    ['inspections', 'Inspection', 'inspection', 'created_at'],
    ['invoices', 'Invoice', 'invoice', 'submitted_at'],
    ['payments', 'Payment', 'payment', 'created_at'],
    ['contracts', 'Contract', 'contract', 'created_at'],
  ];

  linkedTimelineMap.forEach(([key, label, type, timeField]) => {
    (linkedRecords[key] || []).forEach((record) => events.push(timelineEvent({
      id: `${type}-${record.id}`,
      event_type: type,
      title: `${label} ${record.po_number || record.invoice_number || record.receipt_number || record.title || record.id}`,
      description: record.status || record.notes || '',
      actor_name: record.received_by_name || null,
      event_time: record[timeField] || record.updated_at || record.created_at,
      status: record.status || record.acceptance_status || null,
      linked_record_type: type,
      linked_record_id: record.id,
    })));
  });

  attachments.forEach((attachment) => events.push(timelineEvent({
    id: `attachment-${attachment.id}`,
    event_type: 'attachment',
    title: `Attachment uploaded: ${attachment.file_name}`,
    description: attachment.source_type,
    actor_name: attachment.uploaded_by_name,
    event_time: attachment.uploaded_at,
    status: 'Uploaded',
    linked_record_type: 'attachment',
    linked_record_id: attachment.id,
  })));

  communicationNotes.forEach((note) => events.push(timelineEvent({
    id: `log-${note.log_id}`,
    event_type: 'communication',
    title: note.action || 'Request note',
    description: note.comments,
    actor_name: note.actor_name,
    event_time: note.created_at,
    status: note.note_type,
    linked_record_type: 'request_log',
    linked_record_id: note.log_id,
  })));

  auditLogs.forEach((audit) => events.push(timelineEvent({
    id: `audit-${audit.id}`,
    event_type: 'audit',
    title: audit.action || 'Audit event',
    description: audit.description,
    actor_name: audit.actor_name,
    event_time: audit.created_at,
    status: audit.target_type,
    linked_record_type: 'audit_log',
    linked_record_id: audit.id,
  })));

  return events.filter((event) => event.event_time).sort((a, b) => new Date(a.event_time) - new Date(b.event_time));
};

const buildAvailableActions = (user, request, approvals, items) => {
  const role = normalize(user?.role);
  const actions = new Set(['upload_attachment', 'add_note', 'export_pdf']);
  const assignedToUser = Number(request.assigned_to) === Number(user.id) || items.some((item) => Number(item.assigned_to) === Number(user.id));
  const isPrivileged = hasPermission(user, 'requests.manage') || PRIVILEGED_ROLES.has(role);
  const isProcurement = isPrivileged || PROCUREMENT_ROLES.has(role) || assignedToUser;
  const activeApproval = approvals.some((approval) => approval.is_active && Number(approval.approver_id) === Number(user.id) && normalize(approval.status) === 'pending');

  if (activeApproval || hasPermission(user, 'approvals.manage') || APPROVER_ROLES.has(role)) {
    actions.add('approve_request');
    actions.add('reject_request');
    actions.add('request_clarification');
  }

  if (isPrivileged || hasPermission(user, 'requests.assign')) {
    actions.add('assign_procurement');
    if (request.assigned_to) actions.add('reassign_procurement');
  }

  if (isProcurement) {
    actions.add('register_procurement_entry');
    actions.add('generate_rfq');
    actions.add('create_po');
    actions.add('mark_item_unable_to_procure');
  }

  const finalizedStatuses = new Set(['purchased', 'completed', 'not_procured', 'canceled']);
  const allItemsFinalized = items.length > 0 && items.every((item) => finalizedStatuses.has(normalize(item.procurement_status)));

  if (isPrivileged || (isProcurement && allItemsFinalized)) {
    actions.add('mark_request_completed');
  }

  return Array.from(actions);
};

const getFullRequestDetails = async (req, res, next) => {
  const requestId = Number(req.params.requestId);
  if (!isPositiveId(requestId)) return next(createHttpError(400, 'requestId must be a positive integer'));

  try {
    const request = await checkWorkspaceAccess(requestId, req.user);
    if (!request) return next(createHttpError(404, 'Request not found or access denied'));

    const [approvals, items, procurementEvents, linkedRecords, attachments, communicationNotes, auditLogs] = await Promise.all([
      getApprovals(requestId),
      getItems(requestId),
      getProcurementEvents(requestId),
      getLinkedRecords(requestId),
      getAttachments(requestId),
      getCommunicationNotes(requestId),
      getAuditLogs(requestId),
    ]);

    const summary = buildRequestSummary(request, approvals, items);
    res.json({
      request: summary,
      items,
      approvals,
      procurement_events: procurementEvents,
      linked_records: linkedRecords,
      attachments,
      communication_notes: communicationNotes,
      audit_logs: auditLogs,
      timeline: buildTimeline(request, approvals, procurementEvents, linkedRecords, attachments, communicationNotes, auditLogs),
      available_actions: buildAvailableActions(req.user, request, approvals, items),
    });
  } catch (err) {
    console.error('❌ Failed to fetch full request details:', err);
    next(createHttpError(500, 'Failed to fetch full request details'));
  }
};

const addRequestNote = async (req, res, next) => {
  const requestId = Number(req.params.requestId);
  const note = String(req.body?.note || '').trim();
  const noteType = String(req.body?.note_type || 'internal_note').trim();

  if (!isPositiveId(requestId)) return next(createHttpError(400, 'requestId must be a positive integer'));
  if (!note) return next(createHttpError(400, 'note is required'));

  const allowedNoteTypes = new Set(['internal_note', 'department_follow_up', 'supplier_follow_up', 'clarification', 'finance_note', 'warehouse_note']);
  if (!allowedNoteTypes.has(noteType)) return next(createHttpError(400, 'Invalid note_type'));

  const client = await pool.connect();
  try {
    const request = await checkWorkspaceAccess(requestId, req.user);
    if (!request) {
      return next(createHttpError(404, 'Request not found or access denied'));
    }

    await client.query('BEGIN');
    const logRes = await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, $2, $3, $4)
       RETURNING id AS log_id, id AS note_id, request_id, action, comments, timestamp AS created_at`,
      [requestId, noteType, req.user.id, note],
    );

    if (await tableExists('audit_logs')) {
      await client.query(
        `INSERT INTO audit_logs (action, action_type, actor_id, target_type, target_id, description, details)
         VALUES ($1, $2, $3, 'request', $4, $5, $6)`,
        ['Request note added', 'request_note_added', req.user.id, requestId, `Added ${noteType} note to request ${requestId}`, JSON.stringify({ note_type: noteType, note })],
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ message: 'Note added successfully', note: logRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Failed to add request note:', err);
    next(createHttpError(500, 'Failed to add request note'));
  } finally {
    client.release();
  }
};

module.exports = {
  getFullRequestDetails,
  addRequestNote,
  buildTimeline,
  buildAvailableActions,
};