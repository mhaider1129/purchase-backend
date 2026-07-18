const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');
const ensureRequestedItemApprovalColumns = require('../../utils/ensureRequestedItemApprovalColumns');
const ensureRequestedItemReceivedColumns = require('../../utils/ensureRequestedItemReceivedColumns');
const ensureRequestedItemPoIssuanceColumn = require('../../utils/ensureRequestedItemPoIssuanceColumn');
const { ensureWarehouseSupplyApprovalColumns } = require('../../utils/ensureWarehouseSupplyTables');
const { ensureRequestedItemFinancialsTable } = require('../../utils/ensureRequestedItemFinancialsTable');
const { ensureFinanceCoreTables } = require('../../utils/ensureFinanceCoreTables');
const { ensureRequestedItemAssignmentColumns } = require('./assignRequestController');

const getRequestDetails = async (req, res, next) => {
  const { id } = req.params;
  const { id: userId } = req.user;
  const isPrivilegedViewer = req.user.hasPermission('requests.view-all');

  try {
    await ensureRequestedItemAssignmentColumns();
    let accessCheck;

    if (isPrivilegedViewer) {
      accessCheck = await pool.query(
        `SELECT r.*, p.name AS project_name
         FROM requests r
         LEFT JOIN projects p ON r.project_id = p.id
         WHERE r.id = $1
         LIMIT 1`,
        [id],
      );
    } else {
      accessCheck = await pool.query(
        `SELECT r.*, p.name AS project_name
         FROM requests r
         LEFT JOIN projects p ON r.project_id = p.id
         LEFT JOIN approvals a ON r.id = a.request_id
         WHERE r.id = $1 AND (
           r.requester_id = $2
           OR a.approver_id = $2
           OR r.assigned_to = $2
           OR EXISTS (
             SELECT 1 FROM public.requested_items access_ri
             WHERE access_ri.request_id = r.id AND access_ri.assigned_to = $2
           )
         )
         LIMIT 1`,
        [id, userId],
      );
    }

    if (accessCheck.rowCount === 0)
      return next(createHttpError(404, 'Request not found or access denied'));

    const request = accessCheck.rows[0];

    let itemsRes;
    if (request.request_type === 'Warehouse Supply') {
      await ensureWarehouseSupplyApprovalColumns();
      itemsRes = await pool.query(
        `SELECT
           wsi.id,
           wsi.request_id,
           TRUE AS supports_procurement_events,
           wsi.item_name,
           NULL::text AS brand,
           wsi.quantity,
           NULL::numeric AS available_quantity,
           COALESCE(ri.purchased_quantity, 0)::numeric AS purchased_quantity,
           GREATEST(wsi.quantity - COALESCE(ri.purchased_quantity, 0), 0)::numeric AS remaining_quantity,
           procurement_events.latest_procurement_date,
           COALESCE(procurement_events.procurement_events_count, 0)::integer AS procurement_events_count,
           ri.unit_cost,
           ri.total_cost,
           NULL::text AS specs,
           COALESCE(ri.procurement_status, 'pending') AS procurement_status,
           ri.procurement_comment,
           ri.po_issuance_method,
           NULL::text AS approval_status,
         NULL::text AS approval_comments,
         NULL::integer AS approved_by,
         NULL::timestamp AS approved_at,
         NULL::boolean AS is_received,
         NULL::integer AS received_by,
         NULL::timestamp AS received_at,
         NULL::text AS po_number,
         NULL::text AS invoice_number,
         NULL::numeric AS committed_cost,
         NULL::numeric AS paid_cost,
         NULL::text AS currency,
         NULL::text AS savings_driver,
         NULL::text AS savings_notes,
         NULL::numeric AS savings_baseline,
         NULL::integer AS contract_id,
         NULL::numeric AS contract_value_snapshot,
         NULL::integer AS assigned_to,
         NULL::text AS assigned_user_name,
         NULL::text AS assigned_user_role,
         NULL::timestamp AS assigned_at,
         NULL::text AS assignment_notes
       FROM warehouse_supply_items wsi
       LEFT JOIN public.requested_items ri ON ri.id = wsi.requested_item_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS procurement_events_count, MAX(procurement_date) AS latest_procurement_date
         FROM public.procurement_item_events pie
         WHERE pie.requested_item_id = ri.id
       ) procurement_events ON TRUE
       WHERE wsi.request_id = $1`,
        [id]
      );
    } else {
      await ensureRequestedItemApprovalColumns();
      await ensureRequestedItemReceivedColumns();
      await ensureRequestedItemPoIssuanceColumn();
      await ensureRequestedItemFinancialsTable();
      itemsRes = await pool.query(
        `SELECT
           ri.id,
           ri.request_id,
           ri.item_name,
           ri.brand,
           ri.quantity,
           ri.available_quantity,
           ri.purchased_quantity,
           GREATEST(ri.quantity - COALESCE(ri.purchased_quantity, 0), 0) AS remaining_quantity,
           procurement_events.latest_procurement_date,
           COALESCE(procurement_events.procurement_events_count, 0)::integer AS procurement_events_count,
           ri.unit_cost,
           ri.total_cost,
           ri.procurement_status,
           ri.procurement_comment,
           ri.po_issuance_method,
           ri.specs,
           ri.approval_status,
           ri.approval_comments,
           ri.approved_by,
           ri.approved_at,
           ri.is_received,
           ri.received_by,
           ri.received_at,
           rif.po_number,
           rif.invoice_number,
           rif.committed_cost,
           rif.paid_cost,
           rif.currency,
           rif.savings_driver,
           rif.savings_notes,
           rif.savings_baseline,
           rif.contract_id,
           rif.contract_value_snapshot,
           ri.assigned_to,
           assigned_user.name AS assigned_user_name,
           assigned_user.role AS assigned_user_role,
           ri.assigned_at,
           ri.assignment_notes
         FROM public.requested_items ri
         LEFT JOIN public.requested_item_financials rif ON rif.requested_item_id = ri.id
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS procurement_events_count, MAX(procurement_date) AS latest_procurement_date
           FROM public.procurement_item_events pie
           WHERE pie.requested_item_id = ri.id
         ) procurement_events ON TRUE
         LEFT JOIN users assigned_user ON assigned_user.id = ri.assigned_to
         WHERE ri.request_id = $1`,
        [id]
      );
    }

    let assignedUser = null;
    if (request.assigned_to) {
      const assignedRes = await pool.query(
        `SELECT id, name, role FROM users WHERE id = $1`,
        [request.assigned_to],
      );
      assignedUser = assignedRes.rows[0] || null;
    }

    const isSplitAssignee = itemsRes.rows.some((item) => Number(item.assigned_to) === Number(req.user.id))
      && Number(request.assigned_to) !== Number(req.user.id)
      && !isPrivilegedViewer;

    const shouldHideRejectedItems =
      request.status === 'Approved' && (Number(request.assigned_to) === Number(req.user.id) || isSplitAssignee);

    const filteredItems = itemsRes.rows.filter((item) => {
      if (isSplitAssignee && Number(item.assigned_to) !== Number(req.user.id)) return false;
      if (shouldHideRejectedItems && item.approval_status === 'Rejected') return false;
      return true;
    });

    res.json({
      request,
      items: filteredItems,
      assigned_user: assignedUser,
    });
  } catch (err) {
    console.error('❌ Failed to fetch request details:', err);
    next(createHttpError(500, 'Failed to fetch request details'));
  }
};

const getRequestItemsOnly = async (req, res, next) => {
  const { id } = req.params;
  const { id: userId } = req.user;
  const normalizedRole = (req.user.role || '').toString().trim().toLowerCase();
  const isPrivilegedViewer =
    req.user.hasPermission('requests.view-all') ||
    req.user.hasPermission('requests.view-audit') ||
    req.user.hasPermission('requests.view-incomplete') ||
    normalizedRole === 'audit';
  const userWarehouseId = req.user?.warehouse_id;

  try {
    await ensureRequestedItemAssignmentColumns();
    let accessCheck;

    if (isPrivilegedViewer) {
      accessCheck = await pool.query(
        `SELECT r.id, r.request_type, r.status, r.assigned_to
         FROM requests r
         WHERE r.id = $1
         LIMIT 1`,
        [id],
      );
    } else {
      accessCheck = await pool.query(
        `
        SELECT r.id, r.request_type, r.status, r.assigned_to, r.supply_warehouse_id
        FROM requests r
        LEFT JOIN approvals a ON r.id = a.request_id
        WHERE r.id = $1
          AND (
            r.requester_id = $2
            OR a.approver_id = $2
            OR r.assigned_to = $2
            OR EXISTS (
              SELECT 1 FROM public.requested_items access_ri
              WHERE access_ri.request_id = r.id AND access_ri.assigned_to = $2
            )
            ${
              req.user.hasPermission('warehouse.manage-supply') &&
              Number.isInteger(userWarehouseId)
                ? 'OR (r.request_type = \'Warehouse Supply\' AND r.supply_warehouse_id = $3)'
                : ''
            }
          )
        LIMIT 1
        `,
        req.user.hasPermission('warehouse.manage-supply') && Number.isInteger(userWarehouseId)
          ? [id, userId, userWarehouseId]
          : [id, userId],
      );
    }

    if (accessCheck.rowCount === 0) {
      return next(createHttpError(404, 'Request not found or access denied'));
    }

    const requestMeta = accessCheck.rows[0];
    let itemsRes;
    const reqType = requestMeta?.request_type;
    if (reqType === 'Warehouse Supply') {
      await ensureWarehouseSupplyApprovalColumns();
      itemsRes = await pool.query(
        `
      SELECT
        wsi.id,
        wsi.request_id,
        TRUE AS supports_procurement_events,
        wsi.item_name,
        NULL::text AS brand,
        wsi.quantity,
        NULL::numeric AS available_quantity,
        COALESCE(ri.purchased_quantity, 0)::numeric AS purchased_quantity,
        GREATEST(wsi.quantity - COALESCE(ri.purchased_quantity, 0), 0)::numeric AS remaining_quantity,
        procurement_events.latest_procurement_date,
        COALESCE(procurement_events.procurement_events_count, 0)::integer AS procurement_events_count,
        ri.unit_cost,
        ri.total_cost,
        COALESCE(ri.procurement_status, 'pending') AS procurement_status,
        ri.procurement_comment,
        ri.po_issuance_method,
        NULL::text AS specs,
        COALESCE(wsi.approval_status, 'Pending') AS approval_status,
        wsi.approval_comments,
        wsi.approved_by,
        wsi.approved_at,
        NULL::boolean AS is_received,
        NULL::integer AS received_by,
        NULL::timestamp AS received_at,
        NULL::text AS po_number,
        NULL::text AS invoice_number,
        NULL::numeric AS committed_cost,
        NULL::numeric AS paid_cost,
        NULL::text AS currency,
        NULL::text AS savings_driver,
        NULL::text AS savings_notes,
        NULL::numeric AS savings_baseline,
        NULL::integer AS contract_id,
        NULL::numeric AS contract_value_snapshot,
        NULL::integer AS assigned_to,
        NULL::text AS assigned_user_name,
        NULL::text AS assigned_user_role,
        NULL::timestamp AS assigned_at,
        NULL::text AS assignment_notes
      FROM warehouse_supply_items wsi
      LEFT JOIN public.requested_items ri ON ri.id = wsi.requested_item_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS procurement_events_count, MAX(procurement_date) AS latest_procurement_date
        FROM public.procurement_item_events pie
        WHERE pie.requested_item_id = ri.id
      ) procurement_events ON TRUE
      WHERE wsi.request_id = $1
      `,
        [id]
      );
    } else {
      await ensureRequestedItemApprovalColumns();
      await ensureRequestedItemReceivedColumns();
      await ensureRequestedItemPoIssuanceColumn();
      await ensureRequestedItemFinancialsTable();
      itemsRes = await pool.query(
        `
      SELECT
        ri.id,
        ri.request_id,
        TRUE AS supports_procurement_events,
        ri.item_name,
        ri.brand,
        ri.quantity,
        ri.available_quantity,
        ri.purchased_quantity,
        GREATEST(ri.quantity - COALESCE(ri.purchased_quantity, 0), 0) AS remaining_quantity,
        procurement_events.latest_procurement_date,
        COALESCE(procurement_events.procurement_events_count, 0)::integer AS procurement_events_count,
        ri.unit_cost,
        ri.total_cost,
        ri.procurement_status,
        ri.procurement_comment,
        ri.po_issuance_method,
        ri.specs,
        ri.approval_status,
        ri.approval_comments,
        ri.approved_by,
        ri.approved_at,
        ri.is_received,
        ri.received_by,
        ri.received_at,
        rif.po_number,
        rif.invoice_number,
        rif.committed_cost,
        rif.paid_cost,
        rif.currency,
        rif.savings_driver,
        rif.savings_notes,
        rif.savings_baseline,
        rif.contract_id,
        rif.contract_value_snapshot,
        ri.assigned_to,
        assigned_user.name AS assigned_user_name,
        assigned_user.role AS assigned_user_role,
        ri.assigned_at,
        ri.assignment_notes
      FROM public.requested_items ri
      LEFT JOIN public.requested_item_financials rif ON rif.requested_item_id = ri.id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS procurement_events_count, MAX(procurement_date) AS latest_procurement_date
        FROM public.procurement_item_events pie
        WHERE pie.requested_item_id = ri.id
      ) procurement_events ON TRUE
      LEFT JOIN users assigned_user ON assigned_user.id = ri.assigned_to
      WHERE ri.request_id = $1
      `,
        [id]
      );
    }

    const isSplitAssignee = itemsRes.rows.some((item) => Number(item.assigned_to) === Number(req.user.id))
      && Number(requestMeta?.assigned_to) !== Number(req.user.id)
      && !isPrivilegedViewer;

    const shouldHideRejectedItems =
      requestMeta?.status === 'Approved' && (Number(requestMeta?.assigned_to) === Number(req.user.id) || isSplitAssignee);

    const filteredItems = itemsRes.rows.filter((item) => {
      if (isSplitAssignee && Number(item.assigned_to) !== Number(req.user.id)) return false;
      if (shouldHideRejectedItems && item.approval_status === 'Rejected') return false;
      return true;
    });

    res.json({ items: filteredItems });
  } catch (err) {
    console.error('❌ Error in getRequestItemsOnly:', err);
    next(createHttpError(500, 'Failed to fetch request items'));
  }
};

const getMyRequests = async (req, res, next) => {
  const {
    search,
    status,
    requestType,
    request_type,
    from_date,
    to_date,
    fromDate,
    toDate,
  } = req.query;

  try {
    const params = [req.user.id];
    const conditions = [`r.requester_id = $1`];

    if (status) {
      params.push(status);
      conditions.push(`r.status = $${params.length}`);
    }

    const normalizedType = requestType || request_type;
    if (normalizedType) {
      params.push(normalizedType);
      conditions.push(`r.request_type = $${params.length}`);
    }

    const startDate = from_date || fromDate;
    if (startDate) {
      params.push(startDate);
      conditions.push(`r.created_at >= $${params.length}`);
    }

    const endDate = to_date || toDate;
    if (endDate) {
      params.push(endDate);
      conditions.push(`r.created_at <= $${params.length}`);
    }


    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      const placeholder = `$${params.length}`;
      conditions.push(`(
          LOWER(r.justification) LIKE ${placeholder}
          OR LOWER(r.request_type) LIKE ${placeholder}
          OR CAST(r.id AS TEXT) LIKE ${placeholder}
          OR EXISTS (
            SELECT 1 FROM public.requested_items ri
            WHERE ri.request_id = r.id
              AND (
                LOWER(ri.item_name) LIKE ${placeholder}
                OR LOWER(COALESCE(ri.specs, '')) LIKE ${placeholder}
              )
          )
        )`);
    }

    if (Number.isInteger(req.user?.institute_id)) {
      params.push(req.user.institute_id);
      conditions.push(`r.institute_id = $${params.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT
        r.id,
        r.request_type,
        r.justification,
        r.estimated_cost,
        r.status,
        r.created_at,
        r.project_id,
        p.name AS project_name,
        ap.approval_level AS current_approval_level,
        au.role AS current_approver_role,
        au.name AS current_approver_name,
        (
          EXISTS (
            SELECT 1
              FROM approval_logs al
             WHERE al.request_id = r.id
             LIMIT 1
          )
          OR EXISTS (
            SELECT 1
              FROM approvals a
             WHERE a.request_id = r.id
               AND a.status IN ('Approved', 'Rejected')
               AND a.approver_id IS DISTINCT FROM r.requester_id
             LIMIT 1
          )
        ) AS has_approval_activity,
        EXISTS (
          SELECT 1 FROM approvals a
          WHERE a.request_id = r.id AND a.is_urgent = true
        ) AS is_urgent,
        COALESCE(
          (
            SELECT JSON_AGG(
              JSON_BUILD_OBJECT(
                'id', ri.id,
                'item_name', ri.item_name,
                'brand', ri.brand,
                'quantity', ri.quantity,
                'purchased_quantity', ri.purchased_quantity,
                'available_quantity', ri.available_quantity,
                'unit_cost', ri.unit_cost,
                'total_cost', ri.total_cost,
                'specs', ri.specs,
                'procurement_status', ri.procurement_status
              )
              ORDER BY ri.id
            )
            FROM public.requested_items ri
            WHERE ri.request_id = r.id
          ),
          '[]'::json
        ) AS items
       FROM requests r
       LEFT JOIN projects p ON r.project_id = p.id
       LEFT JOIN approvals ap ON r.id = ap.request_id AND ap.is_active = true
       LEFT JOIN users au ON ap.approver_id = au.id
       ${whereClause}
       ORDER BY r.created_at DESC`,
      params,
    );

    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching my requests:', err);
    next(createHttpError(500, 'Failed to fetch your requests'));
  }
};

const parsePositiveIntegerFilter = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseDateFilter = (value) => {
  if (value === undefined || value === null || value === '') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? value : null;
};

const isSchemaMutationPermissionError = (err) => (
  err?.code === '42501'
  || /permission denied/i.test(err?.message || '')
);

const ensureApprovalHistorySchema = async () => {
  try {
    await ensureRequestedItemApprovalColumns();
    await ensureWarehouseSupplyApprovalColumns();
  } catch (err) {
    if (!isSchemaMutationPermissionError(err)) {
      throw err;
    }

    console.warn(
      '⚠️ Skipping approval-history schema auto-migration because the database user cannot run DDL. Apply the Supabase SQL migrations instead.',
      err.message,
    );
  }
};

const buildApprovalHistoryQuery = ({ whereSQL }) => `SELECT
         r.id AS request_id,
         r.request_type,
         r.justification,
         r.estimated_cost,
         r.status,
         a.status AS decision,
         a.comments,
         a.approval_level,
         a.approved_at AS approved_at,
         r.department_id,
         r.section_id,
         d.name AS department_name,
         s.name AS section_name,
         requester.name AS requester_name,
         requester.role AS requester_role,
         p.name AS project_name,
         '[]'::json AS approved_items
       FROM approvals a
       JOIN requests r ON a.request_id = r.id
       LEFT JOIN departments d ON r.department_id = d.id
       LEFT JOIN sections s ON r.section_id = s.id
       LEFT JOIN users requester ON requester.id = r.requester_id
       LEFT JOIN projects p ON p.id = r.project_id
       WHERE ${whereSQL}
       ORDER BY a.approved_at DESC`;

const getApprovalHistory = async (req, res, next) => {
  const rawStatus = typeof req.query.status === 'string' ? req.query.status.trim() : req.query.status;
  const status = ['Approved', 'Rejected'].includes(rawStatus) ? rawStatus : null;
  const departmentId = parsePositiveIntegerFilter(req.query.department_id);
  const fromDate = parseDateFilter(req.query.from_date);
  const toDate = parseDateFilter(req.query.to_date);

  const params = [req.user.id];
  const conditions = [
    `a.approver_id = $1`,
    `a.status IN ('Approved', 'Rejected')`,
  ];

  if (status) {
    params.push(status);
    conditions.push(`a.status = $${params.length}`);
  }

  if (departmentId) {
    params.push(departmentId);
    conditions.push(`r.department_id = $${params.length}`);
  }

  if (fromDate) {
    params.push(fromDate);
    conditions.push(`a.approved_at >= $${params.length}`);
  }

  if (toDate) {
    params.push(toDate);
    conditions.push(`a.approved_at <= $${params.length}`);
  }

  if (Number.isInteger(req.user?.institute_id)) {
    params.push(req.user.institute_id);
    conditions.push(`r.institute_id = $${params.length}`);
  }

  const whereSQL = conditions.join(' AND ');

  try {
    await ensureApprovalHistorySchema();
    const result = await pool.query(
      buildApprovalHistoryQuery({ whereSQL }),
      params,
    );

    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching approval history:', err);
    next(createHttpError(500, 'Failed to fetch approval history'));
  }
};

const getProcurementUsers = async (req, res, next) => {
  try {
    const params = [];
    let instituteClause = '';
    if (Number.isInteger(req.user?.institute_id)) {
      params.push(req.user.institute_id);
      instituteClause = ` AND institute_id = $1`;
    }

    const result = await pool.query(
      `SELECT id, name FROM users
       WHERE role IN ('ProcurementSpecialist', 'SCM')
         AND is_active = true${instituteClause}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to fetch procurement users:', err);
    next(createHttpError(500, 'Failed to fetch procurement users'));
  }
};

const { successResponse, errorResponse } = require('../../utils/responseFormatter');

const getAllRequests = async (req, res, next) => {
  const {
    filter,
    sort,
    request_type,
    search,
    from_date,
    to_date,
    status,
    department_id,
    section_id,
    assigned_to,
    request_id,
    maintenance_ref_number,
    current_step,
    page = 1,
    limit = 10,
  } = req.query;

  const offset = (page - 1) * limit;
  const params = [];
  let whereClauses = [];
  const activeUrgentSort = `CASE
    WHEN r.is_urgent = TRUE
      AND COALESCE(NULLIF(LOWER(TRIM(r.status)), ''), 'pending') NOT IN ('completed', 'rejected', 'received', 'cancelled')
    THEN 1
    ELSE 0
  END DESC`;
  let orderBy = `${activeUrgentSort}, r.created_at DESC`;

  if (filter === 'unassigned') {
    whereClauses.push(`(
      r.assigned_to IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.requested_items unassigned_ri
        WHERE unassigned_ri.request_id = r.id
          AND unassigned_ri.assigned_to IS NOT NULL
      )
    )`);
    params.push('Approved');
    whereClauses.push(`r.status = $${params.length}`);
  }

  if (request_type) {
    const normalizedRequestType = String(request_type).trim().toLowerCase();
    if (normalizedRequestType === 'printing logbook' || normalizedRequestType === 'logbooks') {
      whereClauses.push(`(
        r.request_type = 'Printing Logbook'
        OR EXISTS (
          SELECT 1 FROM public.requested_items ri_logbook
          WHERE ri_logbook.request_id = r.id
            AND LOWER(ri_logbook.item_name) LIKE '%logbook%'
        )
      )`);
    } else {
      params.push(request_type);
      whereClauses.push(`r.request_type = $${params.length}`);
    }
  }

  const trimmedRequestId = typeof request_id === 'string' ? request_id.trim() : '';
  if (trimmedRequestId) {
    params.push(trimmedRequestId);
    whereClauses.push(`CAST(r.id AS TEXT) = $${params.length}`);
  }


  const trimmedMaintenanceRefNumber =
    typeof maintenance_ref_number === 'string' ? maintenance_ref_number.trim() : '';
  if (trimmedMaintenanceRefNumber) {
    params.push(`%${trimmedMaintenanceRefNumber.toLowerCase()}%`);
    whereClauses.push(`LOWER(COALESCE(r.maintenance_ref_number, '')) LIKE $${params.length}`);
  }

  if (current_step) {
    const currentStepValue = Array.isArray(current_step) ? current_step[0] : current_step;
    const normalizedCurrentStep = String(currentStepValue).trim();
    const normalizedCurrentStepLower = normalizedCurrentStep.toLowerCase();
    if (normalizedCurrentStepLower) {
      const activeApprovalExists = `EXISTS (
        SELECT 1
        FROM approvals step_ap
        JOIN users step_user ON step_user.id = step_ap.approver_id
        WHERE step_ap.request_id = r.id
          AND step_ap.is_active = true`;
      switch (normalizedCurrentStepLower) {
        case 'rejected':
          whereClauses.push(`LOWER(TRIM(r.status)) = 'rejected'`);
          break;
        case 'completed':
          whereClauses.push(`LOWER(TRIM(r.status)) = 'completed'`);
          break;
        case 'technical inspection pending':
          whereClauses.push(`LOWER(TRIM(r.status)) = 'technical_inspection_pending'`);
          break;
        case 'received':
          whereClauses.push(`LOWER(TRIM(r.status)) = 'received'`);
          break;
        case 'partially procured':
          whereClauses.push(`LOWER(TRIM(r.status)) = 'partially procured'`);
          break;
        case 'approved':
          whereClauses.push(`LOWER(TRIM(r.status)) = 'approved' AND NOT EXISTS (
            SELECT 1 FROM approvals approved_ap
            WHERE approved_ap.request_id = r.id AND approved_ap.is_active = true
          )`);
          break;
        case 'submitted':
          whereClauses.push(`COALESCE(NULLIF(TRIM(r.status), ''), 'Submitted') = 'Submitted'`);
          break;
        default:
          params.push(normalizedCurrentStep);
          whereClauses.push(`${activeApprovalExists} AND step_user.role = $${params.length})`);
          break;
      }
    }
  }

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    whereClauses.push(`(
      LOWER(r.justification) LIKE $${params.length}
      OR LOWER(r.request_type) LIKE $${params.length}
      OR LOWER(COALESCE(r.temporary_requester_name, requester.name)) LIKE $${params.length}
      OR CAST(r.id AS TEXT) LIKE $${params.length}
      OR EXISTS (
        SELECT 1 FROM public.requested_items ri
        WHERE ri.request_id = r.id
          AND LOWER(ri.item_name) LIKE $${params.length}
      )
    )`);
  }

  if (from_date) {
    params.push(from_date);
    whereClauses.push(`r.created_at >= $${params.length}`);
  }

  if (to_date) {
    params.push(to_date);
    whereClauses.push(`r.created_at <= $${params.length}`);
  }

  if (status) {
    const statusValue = Array.isArray(status) ? status[0] : status;
    if (typeof statusValue === 'string') {
      const normalizedStatus = statusValue.trim().toLowerCase();
      if (normalizedStatus === 'pending') {
        whereClauses.push(
          "COALESCE(NULLIF(LOWER(TRIM(r.status)), ''), 'pending') NOT IN ('completed', 'received', 'approved', 'rejected')"
        );
      } else {
        params.push(normalizedStatus);
        whereClauses.push(`LOWER(TRIM(r.status)) = $${params.length}`);
      }
    } else {
      params.push(String(statusValue).trim().toLowerCase());
      whereClauses.push(`LOWER(TRIM(r.status)) = $${params.length}`);
    }
  }

  if (department_id) {
    params.push(department_id);
    whereClauses.push(`r.department_id = $${params.length}`);
  }

  if (section_id) {
    params.push(section_id);
    whereClauses.push(`r.section_id = $${params.length}`);
  }

  if (assigned_to) {
    const assignedToValue = Array.isArray(assigned_to) ? assigned_to[0] : assigned_to;
    if (String(assignedToValue).trim().toLowerCase() === 'unassigned') {
      whereClauses.push(`(
        r.assigned_to IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.requested_items unassigned_ri
          WHERE unassigned_ri.request_id = r.id
            AND unassigned_ri.assigned_to IS NOT NULL
        )
      )`);
    } else {
      params.push(assignedToValue);
      whereClauses.push(`(
        r.assigned_to = $${params.length}
        OR EXISTS (
          SELECT 1 FROM public.requested_items assigned_ri
          WHERE assigned_ri.request_id = r.id
            AND assigned_ri.assigned_to = $${params.length}
        )
      )`);
    }
  }

  if (Number.isInteger(req.user?.institute_id)) {
    params.push(req.user.institute_id);
    whereClauses.push(`r.institute_id = $${params.length}`);
  }

  if (sort === 'assigned') {
    orderBy = `${activeUrgentSort}, r.assigned_to NULLS LAST, r.created_at DESC`;
  }

  const whereSQL = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  try {
    await ensureRequestedItemAssignmentColumns();
    const result = await pool.query(
      `
      SELECT
        r.*,
        p.name AS project_name,
        d.name AS department_name,
        s.name AS section_name,
        u.name AS assigned_user_name,
        u.role AS assigned_user_role,
        COALESCE((
          SELECT JSON_AGG(DISTINCT JSONB_BUILD_OBJECT('id', split_user.id, 'name', split_user.name, 'role', split_user.role))
          FROM public.requested_items split_ri
          JOIN users split_user ON split_user.id = split_ri.assigned_to
          WHERE split_ri.request_id = r.id
        ), '[]'::json) AS split_assignees,
        COALESCE(r.temporary_requester_name, requester.name) AS requester_name,
        CASE WHEN r.temporary_requester_name IS NOT NULL THEN 'Temporary Requester' ELSE requester.role END AS requester_role,
        ap.approval_level AS current_approval_level,
        au.role AS current_approver_role
      FROM requests r
      JOIN departments d ON r.department_id = d.id
      LEFT JOIN sections s ON r.section_id = s.id
      LEFT JOIN projects p ON r.project_id = p.id
      LEFT JOIN users u ON r.assigned_to = u.id
      LEFT JOIN users requester ON r.requester_id = requester.id
      LEFT JOIN LATERAL (
        SELECT active_ap.*
        FROM approvals active_ap
        WHERE active_ap.request_id = r.id
          AND active_ap.is_active = true
        ORDER BY active_ap.approval_level DESC NULLS LAST, active_ap.id DESC
        LIMIT 1
      ) ap ON TRUE
      LEFT JOIN users au ON ap.approver_id = au.id
      ${whereSQL}
      ORDER BY ${orderBy}
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
      `,
      [...params, limit, offset],
    );

    const totalCountRes = await pool.query(
      `
      SELECT COUNT(*)
      FROM requests r
      LEFT JOIN users requester ON r.requester_id = requester.id
      ${whereSQL}
      `,
      params,
    );

    return res.json({
      data: result.rows,
      total: parseInt(totalCountRes.rows[0].count, 10),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error('❌ Error in getAllRequests:', err);
    return res.status(500).json({ error: 'Failed to fetch requests' });
  }
};

const buildItemSummary = (rows = [], fallbackCost = null) => {
  const summary = {
    total_items: 0,
    purchased_count: 0,
    pending_count: 0,
    not_procured_count: 0,
    calculated_total_cost: 0,
    items_total_cost: 0,
    recorded_total_cost: null,
  };

  rows.forEach((item) => {
    summary.total_items += 1;

    const status = (item.procurement_status || '').toLowerCase();
    if (status === 'purchased' || status === 'completed') {
      summary.purchased_count += 1;
    } else if (status === 'not_procured' || status === 'canceled') {
      summary.not_procured_count += 1;
    } else {
      summary.pending_count += 1;
    }

    const quantity = Number(item.purchased_quantity ?? item.quantity ?? 0);
    const unitCost = Number(item.unit_cost ?? 0);
    if (!Number.isNaN(quantity) && !Number.isNaN(unitCost)) {
      summary.items_total_cost += quantity * unitCost;
    }
  });

  summary.items_total_cost = Number(summary.items_total_cost.toFixed(2));

  const fallbackNumber = Number(fallbackCost);
  const hasFallback = Number.isFinite(fallbackNumber) && fallbackNumber >= 0;
  summary.recorded_total_cost = hasFallback
    ? Number(fallbackNumber.toFixed(2))
    : null;

  if (summary.recorded_total_cost !== null) {
    summary.calculated_total_cost = summary.recorded_total_cost;
  } else if (summary.items_total_cost > 0) {
    summary.calculated_total_cost = summary.items_total_cost;
  } else {
    summary.calculated_total_cost = 0;
  }

  return summary;
};

const getAssignedRequests = async (req, res) => {
  try {
    await ensureRequestedItemAssignmentColumns();
    const overrideAssigneeId = Number.parseInt(req.query?.procurement_user_id, 10);
    const canOverrideAssignee = req.user.hasPermission('requests.manage');

    if (req.query?.procurement_user_id && (!Number.isInteger(overrideAssigneeId) || overrideAssigneeId <= 0)) {
      return errorResponse(res, 400, 'procurement_user_id must be a positive integer');
    }

    if (req.query?.procurement_user_id && !canOverrideAssignee) {
      return errorResponse(res, 403, 'You do not have permission to view another procurement user\'s assigned requests');
    }

    const userId = req.query?.procurement_user_id ? overrideAssigneeId : req.user.id;
    const result = await pool.query(
      `SELECT r.*, p.name AS project_name,
              d.name AS department_name,
              COALESCE(NULLIF(TRIM(r.temporary_requester_name), ''), u.name) AS requester_name,
              CASE
                WHEN NULLIF(TRIM(r.temporary_requester_name), '') IS NOT NULL THEN 'Temporary Requester'
                ELSE u.role
              END AS requester_role
       FROM requests r
       LEFT JOIN projects p ON r.project_id = p.id
       LEFT JOIN departments d ON r.department_id = d.id
       LEFT JOIN sections s ON r.section_id = s.id
       LEFT JOIN users u ON r.requester_id = u.id
       WHERE (
           r.assigned_to = $1
           OR EXISTS (
             SELECT 1 FROM public.requested_items assigned_ri
             WHERE assigned_ri.request_id = r.id AND assigned_ri.assigned_to = $1
           )
         )
         AND COALESCE(NULLIF(LOWER(TRIM(r.status)), ''), 'pending') NOT IN ('completed', 'received')
       ORDER BY r.created_at DESC`,
      [userId],
    );

    const requests = result.rows;
    if (!requests.length) {
      return successResponse(res, 'Assigned requests fetched', []);
    }

    const requestIds = requests.map((row) => row.id);
    const requestStatusById = new Map(requests.map((row) => [row.id, row.status]));
    const itemsRes = await pool.query(
      `SELECT ri.request_id, ri.procurement_status, ri.unit_cost, ri.quantity, ri.purchased_quantity,
              GREATEST(ri.quantity - COALESCE(ri.purchased_quantity, 0), 0) AS remaining_quantity,
              COALESCE(procurement_events.procurement_events_count, 0)::integer AS procurement_events_count,
              procurement_events.latest_procurement_date,
              ri.approval_status, ri.assigned_to
       FROM public.requested_items ri
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS procurement_events_count, MAX(procurement_date) AS latest_procurement_date
         FROM public.procurement_item_events pie
         WHERE pie.requested_item_id = ri.id
       ) procurement_events ON TRUE
       WHERE ri.request_id = ANY($1::int[])`,
      [requestIds],
    );

    const groupedByRequest = itemsRes.rows.reduce((acc, item) => {
      const requestStatus = requestStatusById.get(item.request_id);
      if (item.assigned_to && Number(item.assigned_to) !== Number(userId)) {
        return acc;
      }
      if (requestStatus === 'Approved' && item.approval_status === 'Rejected') {
        return acc;
      }
      if (!acc[item.request_id]) acc[item.request_id] = [];
      acc[item.request_id].push(item);
      return acc;
    }, {});

    const enriched = requests.map((row) => ({
      ...row,
      status_summary: buildItemSummary(
        groupedByRequest[row.id] || [],
        row.estimated_cost,
      ),
    }));

    return successResponse(res, 'Assigned requests fetched', enriched);
  } catch (err) {
    console.error('❌ Error in getAssignedRequests:', err);
    return errorResponse(res, 500, 'Internal server error');
  }
};

const getPendingApprovals = async (req, res, next) => {
  try {
    await ensureFinanceCoreTables();
    const result = await pool.query(
      `SELECT
         a.id AS approval_id,
         r.id AS request_id,
         r.request_type,
         r.justification,
         r.maintenance_ref_number,
         r.estimated_cost,
         r.status,
         r.is_urgent,
         a.comments AS approval_comments,
         CASE
           WHEN a.comments = 'Edit Approval' THEN TRUE
           ELSE FALSE
         END AS is_edit_approval,
         budget_snapshot.budget_envelope_id,
         budget_snapshot.allocated_amount AS budget_allocated_amount,
         budget_snapshot.available_amount AS budget_available_amount,
         budget_snapshot.currency AS budget_currency,
         COALESCE(budget_snapshot.available_amount < COALESCE(r.estimated_cost, 0), FALSE) AS budget_exceeded,
         a.approval_level,
         COALESCE((
           SELECT JSON_AGG(
             JSON_BUILD_OBJECT(
               'approval_id', prior.id,
               'approval_level', prior.approval_level,
               'approver_id', prior.approver_id,
               'approver_name', prior_user.name,
               'approver_role', prior_user.role,
               'approved_at', prior.approved_at
             )
             ORDER BY prior.approval_level ASC, prior.approved_at ASC NULLS LAST, prior.id ASC
           )
           FROM approvals prior
           JOIN users prior_user ON prior.approver_id = prior_user.id
           WHERE prior.request_id = r.id
             AND prior.status = 'Approved'
             AND prior.approval_level < a.approval_level
         ), '[]'::json) AS previous_approvers,
         r.project_id,
         p.name AS project_name,
         r.department_id,
         r.section_id,
         d.name AS department_name,
         s.name AS section_name,
         s.name AS section_name,
         COALESCE(NULLIF(TRIM(r.temporary_requester_name), ''), requester.name) AS requester_name,
         CASE
           WHEN NULLIF(TRIM(r.temporary_requester_name), '') IS NOT NULL THEN 'Temporary Requester'
           ELSE requester.role
         END AS requester_role
       FROM requests r
       LEFT JOIN projects p ON r.project_id = p.id
       LEFT JOIN departments d ON r.department_id = d.id
       LEFT JOIN sections s ON r.section_id = s.id
       LEFT JOIN users requester ON r.requester_id = requester.id
       LEFT JOIN LATERAL (
         SELECT
           be.id AS budget_envelope_id,
           be.allocated_amount,
           be.currency,
           be.allocated_amount - COALESCE((
             SELECT SUM(cl.amount)
             FROM commitment_ledger cl
             WHERE cl.budget_envelope_id = be.id
               AND cl.stage = 'actual'
           ), 0) AS available_amount
         FROM budget_envelopes be
         WHERE be.department_id = r.department_id
           AND COALESCE(be.project_id::text, '') = COALESCE(r.project_id::text, '')
           AND be.fiscal_year = EXTRACT(YEAR FROM NOW())::integer
           AND be.currency = 'USD'
         LIMIT 1
       ) budget_snapshot ON TRUE
       JOIN approvals a ON r.id = a.request_id
       WHERE a.approver_id = $1
         AND a.is_active = true
         AND a.status = 'Pending'
         ORDER BY r.created_at DESC`,
      [req.user.id],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to fetch pending approvals:', err);
    next(createHttpError(500, 'Server error while fetching pending approvals'));
  }
};

const getHodApprovers = async (req, res, next) => {
  const normalizedRole = (req.user?.role || '').toUpperCase();

  if (!['SCM', 'ADMIN'].includes(normalizedRole)) {
    return next(createHttpError(403, 'Only SCM or Admin users can fetch department HOD approvers'));
  }

  try {
    const { rows } = await pool.query(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.department_id,
         d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE LOWER(u.role) = 'hod'
         AND u.is_active = true
       ORDER BY d.name NULLS LAST, u.name`,
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to load HOD approvers:', err);
    next(createHttpError(500, 'Failed to load HOD approvers'));
  }
};

const getMyMaintenanceRequests = async (req, res, next) => {
  const normalizedRole = (req.user?.role || '').toString().trim().toLowerCase();
  const canViewAllMaintenanceRequests =
    normalizedRole === 'engineer' || req.user.hasPermission?.('requests.view-all');
  const viewerFilter = canViewAllMaintenanceRequests
    ? ''
    : 'AND r.initiated_by_technician_id = $1';
  const queryParams = canViewAllMaintenanceRequests ? [] : [req.user.id];

  try {
    const result = await pool.query(
      `WITH approval_timelines AS (
         SELECT
           ap.request_id,
           MIN(ap.updated_at) AS approval_started_at,
           MIN(ap.approved_at) FILTER (WHERE ap.approved_at IS NOT NULL) AS first_approval_at,
           MAX(ap.approved_at) FILTER (WHERE ap.status = 'Approved' AND ap.approved_at IS NOT NULL) AS final_approval_at,
           STRING_AGG(
             CONCAT(
               'Level ', COALESCE(ap.approval_level::text, '—'),
               ': ', COALESCE(NULLIF(ap.status, ''), 'Pending'),
               CASE WHEN approver.name IS NOT NULL THEN CONCAT(' by ', approver.name) ELSE '' END,
               CASE WHEN approver.role IS NOT NULL THEN CONCAT(' (', approver.role, ')') ELSE '' END,
               CASE WHEN ap.approved_at IS NOT NULL THEN CONCAT(' on ', TO_CHAR(ap.approved_at, 'YYYY-MM-DD HH24:MI')) ELSE '' END
             ),
             ' | ' ORDER BY ap.approval_level ASC NULLS LAST, ap.id ASC
           ) AS approval_timeline
         FROM approvals ap
         LEFT JOIN users approver ON approver.id = ap.approver_id
         GROUP BY ap.request_id
       )
       SELECT
         r.id,
         r.justification,
         r.maintenance_ref_number,
         r.status,
         r.created_at,
         CONCAT('Submitted on ', TO_CHAR(r.created_at, 'YYYY-MM-DD HH24:MI'), ' by ', COALESCE(r.temporary_requester_name, u.name, 'Unknown requester')) AS submission_timeline,
         r.project_id,
         r.is_urgent,
         p.name AS project_name,
         r.department_id,
         r.section_id,
         d.name AS department_name,
         s.name AS section_name,
         COALESCE(r.temporary_requester_name, u.name) AS requester_name,
         COALESCE(
           JSON_AGG(
             JSON_BUILD_OBJECT(
               'id', ri.id,
               'item_name', ri.item_name,
               'brand', ri.brand,
               'quantity', ri.quantity,
               'purchased_quantity', ri.purchased_quantity,
               'available_quantity', ri.available_quantity,
               'unit_cost', ri.unit_cost,
               'total_cost', ri.total_cost,
               'specs', ri.specs,
               'procurement_status', ri.procurement_status
             )
             ORDER BY ri.id
           ) FILTER (WHERE ri.id IS NOT NULL),
           '[]'::json
         ) AS items,
         (
           SELECT MIN(ap.approval_level)
           FROM approvals ap
           WHERE ap.request_id = r.id
             AND ap.status = 'Pending'
         ) AS current_approval_step,
         (
           SELECT u.name
           FROM approvals ap
           JOIN users u ON ap.approver_id = u.id
           WHERE ap.request_id = r.id
             AND ap.status = 'Pending'
             AND ap.is_active = true
           ORDER BY ap.approval_level ASC
           LIMIT 1
         ) AS current_pending_approver_name,
         (
           SELECT u.role
           FROM approvals ap
           JOIN users u ON ap.approver_id = u.id
           WHERE ap.request_id = r.id
             AND ap.status = 'Pending'
             AND ap.is_active = true
           ORDER BY ap.approval_level ASC
           LIMIT 1
         ) AS current_pending_approver_role,
         CASE
           WHEN r.status IN ('Approved', 'Completed') THEN (
             SELECT MAX(ap.approved_at)
             FROM approvals ap
             WHERE ap.request_id = r.id
               AND ap.status = 'Approved'
           )
           ELSE NULL
         END AS final_approval_date,
         CASE
           WHEN r.status IN ('Approved', 'Completed') THEN (
             SELECT u.name
             FROM approvals ap
             JOIN users u ON ap.approver_id = u.id
             WHERE ap.request_id = r.id
               AND ap.status = 'Approved'
             ORDER BY ap.approval_level DESC, ap.approved_at DESC NULLS LAST
             LIMIT 1
           )
           ELSE NULL
         END AS final_approver_name,
         at.approval_started_at,
         at.first_approval_at,
         at.final_approval_at,
         at.approval_timeline,
         CASE
           WHEN at.final_approval_at IS NULL THEN NULL
           ELSE ROUND(EXTRACT(EPOCH FROM (at.final_approval_at - r.created_at)) / 86400.0, 2)
         END AS approval_duration_days,
         (
           SELECT COUNT(*)
           FROM attachments att
           WHERE att.request_id = r.id
         ) AS attachments_count
       FROM requests r
       LEFT JOIN projects p ON r.project_id = p.id
       LEFT JOIN departments d ON r.department_id = d.id
       LEFT JOIN sections s ON r.section_id = s.id
       LEFT JOIN users u ON r.requester_id = u.id
       LEFT JOIN approval_timelines at ON at.request_id = r.id
       LEFT JOIN public.requested_items ri ON ri.request_id = r.id
       WHERE r.request_type = 'Maintenance'
         ${viewerFilter}
       GROUP BY
         r.id,
         r.justification,
         r.maintenance_ref_number,
         r.status,
         r.created_at,
         r.project_id,
         r.is_urgent,
         p.name,
         r.department_id,
         r.section_id,
         d.name,
         s.name,
         u.name,
         r.temporary_requester_name,
         at.approval_started_at,
         at.first_approval_at,
         at.final_approval_at,
         at.approval_timeline
       ORDER BY r.created_at DESC`,
      queryParams,
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching maintenance requests:', err);
    next(createHttpError(500, 'Failed to fetch maintenance requests'));
  }
};

const getPendingMaintenanceApprovals = async (req, res, next) => {
  try {
    await ensureFinanceCoreTables();
    const { rows } = await pool.query(
      `SELECT
         a.id AS approval_id,
         r.id AS request_id,
         r.justification,
         r.maintenance_ref_number,
         r.is_urgent,
         r.estimated_cost,
         budget_snapshot.budget_envelope_id,
         budget_snapshot.allocated_amount AS budget_allocated_amount,
         budget_snapshot.available_amount AS budget_available_amount,
         budget_snapshot.currency AS budget_currency,
         COALESCE(budget_snapshot.available_amount < COALESCE(r.estimated_cost, 0), FALSE) AS budget_exceeded,
         a.approval_level,
         COALESCE((
           SELECT JSON_AGG(
             JSON_BUILD_OBJECT(
               'approval_id', prior.id,
               'approval_level', prior.approval_level,
               'approver_id', prior.approver_id,
               'approver_name', prior_user.name,
               'approver_role', prior_user.role,
               'approved_at', prior.approved_at
             )
             ORDER BY prior.approval_level ASC, prior.approved_at ASC NULLS LAST, prior.id ASC
           )
           FROM approvals prior
           JOIN users prior_user ON prior.approver_id = prior_user.id
           WHERE prior.request_id = r.id
             AND prior.status = 'Approved'
             AND prior.approval_level < a.approval_level
         ), '[]'::json) AS previous_approvers,
         COALESCE(r.temporary_requester_name, u.name) AS requester_name,
         d.name AS department_name,
         s.name AS section_name,
         r.created_at,
         r.project_id,
         p.name AS project_name,
         COALESCE(
           JSON_AGG(
             JSON_BUILD_OBJECT(
               'id', ri.id,
               'item_name', ri.item_name,
               'brand', ri.brand,
               'quantity', ri.quantity,
               'available_quantity', ri.available_quantity,
               'unit_cost', ri.unit_cost,
               'total_cost', ri.total_cost,
               'specs', ri.specs,
               'approval_status', ri.approval_status,
               'approval_comments', ri.approval_comments,
               'approved_by', ri.approved_by,
               'approved_at', ri.approved_at
             )
             ORDER BY ri.id
           ) FILTER (WHERE ri.id IS NOT NULL),
           '[]'
         ) AS items
       FROM requests r
       JOIN users u ON r.requester_id = u.id
       JOIN departments d ON r.department_id = d.id
       LEFT JOIN sections s ON r.section_id = s.id
       JOIN approvals a ON a.request_id = r.id
       LEFT JOIN projects p ON r.project_id = p.id
       LEFT JOIN LATERAL (
         SELECT
           be.id AS budget_envelope_id,
           be.allocated_amount,
           be.currency,
           be.allocated_amount - COALESCE((
             SELECT SUM(cl.amount)
             FROM commitment_ledger cl
             WHERE cl.budget_envelope_id = be.id
               AND cl.stage = 'actual'
           ), 0) AS available_amount
         FROM budget_envelopes be
         WHERE be.department_id = r.department_id
           AND COALESCE(be.project_id::text, '') = COALESCE(r.project_id::text, '')
           AND be.fiscal_year = EXTRACT(YEAR FROM NOW())::integer
           AND be.currency = 'USD'
         LIMIT 1
       ) budget_snapshot ON TRUE
       LEFT JOIN public.requested_items ri ON ri.request_id = r.id
       WHERE r.request_type = 'Maintenance'
         AND a.approver_id = $1
         AND a.status = 'Pending'
         AND a.is_active = true
       GROUP BY a.id, r.id, r.temporary_requester_name, u.name, d.name, s.name, p.name,
         budget_snapshot.budget_envelope_id,
         budget_snapshot.allocated_amount,
         budget_snapshot.available_amount,
         budget_snapshot.currency
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Error fetching maintenance approvals:', err);
    next(createHttpError(500, 'Failed to fetch maintenance requests'));
  }
};

const getAuditApprovedRejectedRequests = async (req, res, next) => {
  const normalizedRole = (req.user.role || '').toString().trim().toLowerCase();
  const hasAuditPermission =
    typeof req.user.hasPermission === 'function' &&
    (req.user.hasPermission('requests.view-audit') ||
      req.user.hasPermission('requests.view-incomplete'));

  if (!hasAuditPermission && normalizedRole !== 'audit') {
    return next(createHttpError(403, 'Access denied'));
  }

  try {
    const statusFilter = ['approved', 'rejected', 'completed', 'received'];
    const { rows } = await pool.query(
      `SELECT r.id,
              r.request_type,
              r.justification,
              r.status,
              r.project_id,
              r.department_id,
              r.section_id,
              COALESCE(r.print_count, 0) AS print_count,
              COALESCE(NULLIF(TRIM(r.temporary_requester_name), ''), requester.name) AS requester_name,
              d.name AS department_name,
              s.name AS section_name,
              p.name AS project_name,
              COALESCE(MAX(a.approved_at), r.updated_at, r.created_at) AS approval_timestamp
         FROM requests r
         LEFT JOIN projects p ON r.project_id = p.id
         LEFT JOIN users requester ON r.requester_id = requester.id
         LEFT JOIN departments d ON r.department_id = d.id
         LEFT JOIN sections s ON r.section_id = s.id
         LEFT JOIN approvals a ON r.id = a.request_id
        WHERE LOWER(TRIM(r.status)) = ANY($1::text[])
        GROUP BY r.id, r.request_type, r.justification, r.status, p.name, requester.name, d.name, s.name
        ORDER BY approval_timestamp DESC`,
      [statusFilter]
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to fetch audit requests:', err);
    next(createHttpError(500, 'Failed to fetch audit requests'));
  }
};

const getClosedRequests = async (req, res, next) => {
  try {
    const closedStatuses = ['completed', 'rejected', 'received', 'technical_inspection_pending'];

    const result = await pool.query(
      `SELECT
         r.id,
         r.request_type,
         r.justification,
         r.status,
         r.project_id,
         r.created_at,
         r.updated_at,
         r.requester_id,
         r.assigned_to,
         r.is_urgent,
         p.name AS project_name,
         u.name AS assigned_user_name,
         COALESCE(
           JSON_AGG(
             JSON_BUILD_OBJECT(
               'id', ri.id,
               'item_name', ri.item_name,
               'brand', ri.brand,
               'quantity', ri.quantity,
               'purchased_quantity', ri.purchased_quantity,
               'available_quantity', ri.available_quantity,
               'unit_cost', ri.unit_cost,
               'total_cost', ri.total_cost,
               'specs', ri.specs,
               'procurement_status', ri.procurement_status,
               'is_received', ri.is_received,
               'received_at', ri.received_at,
               'received_by', ri.received_by,
               'received_quantity', ri.received_quantity,
               'receipt_issue_status', ri.receipt_issue_status,
               'receipt_issue_quantity', ri.receipt_issue_quantity,
               'receipt_issue_notes', ri.receipt_issue_notes,
               'receipt_issue_reported_at', ri.receipt_issue_reported_at
             )
             ORDER BY ri.id
           ) FILTER (WHERE ri.id IS NOT NULL),
           '[]'::json
         ) AS items
       FROM requests r
       LEFT JOIN projects p ON r.project_id = p.id
       LEFT JOIN users u ON r.assigned_to = u.id
       LEFT JOIN public.requested_items ri ON ri.request_id = r.id
       WHERE LOWER(TRIM(r.status)) = ANY($2::text[])
         AND r.requester_id = $1
       GROUP BY
         r.id,
         r.request_type,
         r.justification,
         r.status,
         r.project_id,
         r.created_at,
         r.updated_at,
         r.requester_id,
         r.assigned_to,
         r.is_urgent,
         p.name,
         u.name
       ORDER BY r.updated_at DESC`,
      [req.user.id, closedStatuses]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to fetch closed requests:', err);
    next(createHttpError(500, 'Failed to fetch closed requests'));
  }
};

const getRequestLogs = async (req, res, next) => {
  const requestId = req.params.id;

  try {
    const { rows } = await pool.query(
      `SELECT rl.*, u.name AS actor_name
       FROM request_logs rl
       LEFT JOIN users u ON rl.actor_id = u.id
       WHERE rl.request_id = $1
       ORDER BY rl.timestamp ASC`,
      [requestId],
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to fetch request logs:', err);
    next(createHttpError(500, 'Failed to fetch request logs'));
  }
};

module.exports = {
  getRequestDetails,
  getRequestItemsOnly,
  getMyRequests,
  getAllRequests,
  getPendingApprovals,
  getHodApprovers,
  getAssignedRequests,
  getApprovalHistory,
  getProcurementUsers,
  getMyMaintenanceRequests,
  getPendingMaintenanceApprovals,
  getAuditApprovedRejectedRequests,
  getClosedRequests,
  getRequestLogs,
};