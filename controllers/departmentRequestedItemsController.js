const pool = require('../config/db');
const ensureDepartmentItemFollowUpNotesTable = require('../utils/ensureDepartmentItemFollowUpNotesTable');

const PRIVILEGED_ROLES = new Set(['admin', 'scm', 'procurementsupervisor']);
const DEPARTMENT_ROLES = new Set(['hod', 'requester']);
const CLOSED_REQUEST_STATUSES = ['rejected', 'cancelled', 'canceled', 'closed', 'completed', 'received'];
const FULLY_PROCURED_STATUSES = ['fully procured', 'completed', 'complete', 'received'];
const ALLOWED_SORTS = new Set([
  'department_name',
  'section_name',
  'request_date',
  'item_name',
  'remaining_quantity',
  'days_since_request',
  'required_delivery_date',
  'procurement_status',
]);

const SORT_EXPRESSIONS = {
  department_name: 'LOWER(department_name)',
  section_name: 'LOWER(COALESCE(section_name, \'\'))',
  request_date: 'request_date',
  item_name: 'LOWER(item_name)',
  remaining_quantity: 'remaining_quantity',
  days_since_request: 'days_since_request',
  required_delivery_date: 'required_delivery_date',
  procurement_status: 'LOWER(procurement_status)',
};

const normalizeRole = role => String(role || '').trim().toLowerCase();
const isTrue = value => ['true', '1', 'yes', 'y'].includes(String(value).trim().toLowerCase());
const intOrNull = value => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const getAccessScope = user => {
  const role = normalizeRole(user?.role);
  if (PRIVILEGED_ROLES.has(role)) return { type: 'all' };
  if (DEPARTMENT_ROLES.has(role) && Number.isInteger(user?.department_id)) {
    const assignedSectionIds = Array.isArray(user?.assigned_section_ids)
      ? user.assigned_section_ids.filter(Number.isInteger)
      : [];
    const sectionIds = role === 'requester'
      ? Array.from(new Set([user.section_id, ...assignedSectionIds].filter(Number.isInteger)))
      : [];
    return {
      type: role === 'requester' && sectionIds.length > 0 ? 'department-section' : 'department',
      departmentId: user.department_id,
      sectionId: role === 'requester' ? user.section_id : null,
      sectionIds,
    };
  }
  return null;
};

const addParam = (values, value) => {
  values.push(value);
  return `$${values.length}`;
};

const buildWhereClause = (query = {}, user) => {
  const values = [];
  const where = ['1=1'];
  const scope = getAccessScope(user);

  if (!scope) {
    return { forbidden: true, whereSql: '', values };
  }

  if (scope.type !== 'all') {
    where.push(`r.department_id = ${addParam(values, scope.departmentId)}`);
    if (scope.type === 'department-section' && Array.isArray(scope.sectionIds) && scope.sectionIds.length > 0) {
      if (scope.sectionIds.length === 1) {
        where.push(`r.section_id = ${addParam(values, scope.sectionIds[0])}`);
      } else {
        where.push(`r.section_id = ANY(${addParam(values, scope.sectionIds)}::int[])`);
      }
    }
  }

  if (Number.isInteger(user?.institute_id)) {
    where.push(`COALESCE(r.institute_id, d.institute_id) = ${addParam(values, user.institute_id)}`);
  }

  const filters = [
    ['department_id', 'r.department_id'],
    ['section_id', 'r.section_id'],
    ['requester_id', 'r.requester_id'],
  ];
  filters.forEach(([key, column]) => {
    const value = intOrNull(query[key]);
    if (value !== null) where.push(`${column} = ${addParam(values, value)}`);
  });

  ['request_type', 'approval_status', 'procurement_status'].forEach(key => {
    const value = String(query[key] || '').trim();
    if (value) where.push(`LOWER(COALESCE(${key === 'request_type' ? 'r.request_type' : key === 'approval_status' ? 'ri.approval_status' : 'ri.procurement_status'}, '')) = LOWER(${addParam(values, value)})`);
  });

  if (query.date_from) where.push(`r.created_at::date >= ${addParam(values, query.date_from)}`);
  if (query.date_to) where.push(`r.created_at::date <= ${addParam(values, query.date_to)}`);

  // The production schema may add a request or item due-date column later. The endpoint returns NULL today.
  if (query.required_delivery_from || query.required_delivery_to) {
    where.push('1=0');
  }

  if (isTrue(query.emergency_only)) where.push('r.is_urgent = TRUE');
  if (isTrue(query.overdue_only)) where.push('r.created_at::date < CURRENT_DATE');

  const search = String(query.search || '').trim();
  if (search) {
    const placeholder = addParam(values, `%${search}%`);
    where.push(`(
      ri.item_name ILIKE ${placeholder}
      OR COALESCE(ri.brand, '') ILIKE ${placeholder}
      OR COALESCE(ri.intended_use, '') ILIKE ${placeholder}
      OR COALESCE(ri.specs, '') ILIKE ${placeholder}
      OR COALESCE(r.justification, '') ILIKE ${placeholder}
      OR COALESCE(d.name, '') ILIKE ${placeholder}
      OR COALESCE(s.name, '') ILIKE ${placeholder}
      OR COALESCE(requester.name, r.temporary_requester_name, '') ILIKE ${placeholder}
      OR CAST(r.id AS TEXT) ILIKE ${placeholder}
    )`);
  }

  if (!isTrue(query.include_completed)) {
    where.push(`LOWER(COALESCE(r.status, '')) <> ALL(${addParam(values, CLOSED_REQUEST_STATUSES)}::text[])`);
    where.push(`LOWER(COALESCE(ri.procurement_status, 'pending')) <> ALL(${addParam(values, FULLY_PROCURED_STATUSES)}::text[])`);
    where.push('GREATEST(COALESCE(ri.quantity, 0) - COALESCE(ri.purchased_quantity, 0), 0) > 0');
  }

  return { whereSql: where.join(' AND '), values };
};

const baseSelect = whereSql => `
  WITH latest_events AS (
    SELECT DISTINCT ON (requested_item_id)
      requested_item_id,
      created_at,
      procurement_date,
      procurement_note
    FROM public.procurement_item_events
    ORDER BY requested_item_id, created_at DESC, id DESC
  ), latest_notes AS (
    SELECT DISTINCT ON (requested_item_id)
      requested_item_id,
      note,
      department_response,
      created_at
    FROM public.department_item_follow_up_notes
    ORDER BY requested_item_id, created_at DESC, id DESC
  ), approval_timelines AS (
    SELECT
      a.request_id,
      MIN(a.updated_at) AS approval_started_at,
      MIN(a.approved_at) FILTER (WHERE a.approved_at IS NOT NULL) AS first_approval_at,
      MAX(a.approved_at) FILTER (WHERE a.status = 'Approved' AND a.approved_at IS NOT NULL) AS final_approval_at,
      STRING_AGG(
        CONCAT(
          'Level ', COALESCE(a.approval_level::text, '—'),
          ': ', COALESCE(NULLIF(a.status, ''), 'Pending'),
          CASE WHEN approver.name IS NOT NULL THEN CONCAT(' by ', approver.name) ELSE '' END,
          CASE WHEN approver.role IS NOT NULL THEN CONCAT(' (', approver.role, ')') ELSE '' END,
          CASE WHEN a.approved_at IS NOT NULL THEN CONCAT(' on ', TO_CHAR(a.approved_at, 'YYYY-MM-DD HH24:MI')) ELSE '' END
        ),
        ' | ' ORDER BY a.approval_level ASC NULLS LAST, a.id ASC
      ) AS approval_timeline
    FROM public.approvals a
    LEFT JOIN public.users approver ON approver.id = a.approver_id
    GROUP BY a.request_id
  ), item_rows AS (
    SELECT
      r.id AS request_id,
      r.id::text AS request_number,
      r.created_at AS request_date,
      CONCAT('Submitted on ', TO_CHAR(r.created_at, 'YYYY-MM-DD HH24:MI'), ' by ', COALESCE(r.temporary_requester_name, requester.name, 'Unknown requester')) AS submission_timeline,
      r.request_type,
      r.status AS request_status,
      ri.approval_status,
      r.department_id,
      d.name AS department_name,
      r.section_id,
      s.name AS section_name,
      r.requester_id,
      COALESCE(r.temporary_requester_name, requester.name) AS requester_name,
      requester.phone_number AS requester_phone,
      requester.email AS requester_email,
      ri.id AS item_id,
      ri.item_name,
      ri.brand,
      ri.specs,
      NULL::text AS category,
      NULL::text AS sub_category,
      COALESCE(ri.quantity, 0) AS requested_quantity,
      COALESCE(ri.purchased_quantity, 0) AS purchased_quantity,
      GREATEST(COALESCE(ri.quantity, 0) - COALESCE(ri.purchased_quantity, 0), 0) AS remaining_quantity,
      COALESCE(NULLIF(ri.procurement_status, ''), 'pending') AS procurement_status,
      COALESCE(ri.assigned_to, r.assigned_to) AS assigned_to_id,
      assigned_user.name AS assigned_to_name,
      NULL::date AS required_delivery_date,
      CASE WHEN r.is_urgent THEN 'Emergency' ELSE NULL END AS priority,
      COALESCE(r.is_urgent, FALSE) AS emergency_flag,
      r.justification,
      ri.intended_use,
      at.approval_started_at,
      at.first_approval_at,
      at.final_approval_at,
      at.approval_timeline,
      CASE
        WHEN at.final_approval_at IS NULL THEN NULL
        ELSE ROUND(EXTRACT(EPOCH FROM (at.final_approval_at - r.created_at)) / 86400.0, 2)
      END AS approval_duration_days,
      COALESCE(le.created_at, ri.procurement_updated_at, ri.marked_at) AS last_procurement_update,
      GREATEST(0, DATE_PART('day', CURRENT_TIMESTAMP - r.created_at)::int) AS days_since_request,
      ln.note AS latest_follow_up_note,
      ln.department_response AS latest_department_response,
      le.procurement_note AS latest_procurement_event,
      (r.created_at::date < CURRENT_DATE) AS overdue_flag,
      (COALESCE(ri.purchased_quantity, 0) > 0 AND GREATEST(COALESCE(ri.quantity, 0) - COALESCE(ri.purchased_quantity, 0), 0) > 0) AS partially_procured_flag
    FROM public.requested_items ri
    JOIN public.requests r ON r.id = ri.request_id
    JOIN public.departments d ON d.id = r.department_id
    LEFT JOIN public.sections s ON s.id = r.section_id
    LEFT JOIN public.users requester ON requester.id = r.requester_id
    LEFT JOIN public.users assigned_user ON assigned_user.id = COALESCE(ri.assigned_to, r.assigned_to)
    LEFT JOIN latest_events le ON le.requested_item_id = ri.id
    LEFT JOIN latest_notes ln ON ln.requested_item_id = ri.id
    LEFT JOIN approval_timelines at ON at.request_id = r.id
    WHERE ${whereSql}
  )
`;

const getGroupKey = groupBy => ['department', 'section', 'requester', 'request_type'].includes(groupBy) ? groupBy : 'none';

const groupRows = (rows, groupBy) => {
  const key = getGroupKey(groupBy);
  if (key === 'none') return [];

  const groups = new Map();
  rows.forEach(row => {
    const idField = key === 'request_type' ? 'request_type' : `${key}_id`;
    const nameField = key === 'request_type' ? 'request_type' : `${key}_name`;
    const groupId = row[idField] ?? row[nameField] ?? 'Unassigned';
    if (!groups.has(groupId)) {
      groups.set(groupId, {
        [`${key}_id`]: key === 'request_type' ? undefined : row[idField],
        [`${key}_name`]: row[nameField] || 'Unassigned',
        open_items_count: 0,
        overdue_count: 0,
        emergency_count: 0,
        partially_procured_count: 0,
        last_request_date: null,
        items: [],
      });
    }
    const group = groups.get(groupId);
    group.open_items_count += 1;
    if (row.overdue_flag) group.overdue_count += 1;
    if (row.emergency_flag) group.emergency_count += 1;
    if (row.partially_procured_flag) group.partially_procured_count += 1;
    if (!group.last_request_date || new Date(row.request_date) > new Date(group.last_request_date)) {
      group.last_request_date = row.request_date;
    }
    group.items.push(row);
  });

  return Array.from(groups.values());
};

const getDepartmentRequestedItems = async (req, res, next) => {
  try {
    await ensureDepartmentItemFollowUpNotesTable();
    const { forbidden, whereSql, values } = buildWhereClause(req.query, req.user);
    if (forbidden) return res.status(403).json({ message: 'You do not have access to department requested items.' });

    const page = Math.max(intOrNull(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(intOrNull(req.query.limit) || 50, 1), 250);
    const offset = (page - 1) * limit;
    const sortBy = ALLOWED_SORTS.has(req.query.sort_by) ? req.query.sort_by : null;
    const sortDir = String(req.query.sort_dir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const orderSql = sortBy
      ? `${SORT_EXPRESSIONS[sortBy]} ${sortDir} NULLS LAST, emergency_flag DESC, overdue_flag DESC, request_date ASC`
      : 'LOWER(department_name) ASC, LOWER(COALESCE(section_name, \'\')) ASC, emergency_flag DESC, overdue_flag DESC, request_date ASC';

    const baseSql = baseSelect(whereSql);
    const countResult = await pool.query(`${baseSql} SELECT COUNT(*)::int AS total FROM item_rows`, values);
    const total = countResult.rows[0]?.total || 0;

    const dataValues = [...values, limit, offset];
    const dataResult = await pool.query(
      `${baseSql} SELECT * FROM item_rows ORDER BY ${orderSql} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      dataValues
    );

    const summaryResult = await pool.query(
      `${baseSql}
       SELECT
         COUNT(*)::int AS total_open_items,
         COUNT(DISTINCT department_id)::int AS total_departments,
         COUNT(*) FILTER (WHERE overdue_flag)::int AS overdue_items,
         COUNT(*) FILTER (WHERE emergency_flag)::int AS emergency_items,
         COUNT(*) FILTER (WHERE partially_procured_flag)::int AS partially_procured_items
       FROM item_rows`,
      values
    );

    res.json({
      data: dataResult.rows,
      summary: summaryResult.rows[0] || {
        total_open_items: 0,
        total_departments: 0,
        overdue_items: 0,
        emergency_items: 0,
        partially_procured_items: 0,
      },
      grouped: groupRows(dataResult.rows, req.query.group_by || 'department'),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
};

const getSummary = async (req, res, next) => {
  try {
    await ensureDepartmentItemFollowUpNotesTable();
    const { forbidden, whereSql, values } = buildWhereClause({ ...req.query, include_completed: 'false' }, req.user);
    if (forbidden) return res.status(403).json({ message: 'You do not have access to department requested items.' });
    const baseSql = baseSelect(whereSql);
    const { rows } = await pool.query(
      `${baseSql}
       SELECT json_build_object(
         'open_items_by_department', COALESCE((SELECT json_agg(row_to_json(x)) FROM (SELECT department_id, department_name, COUNT(*)::int AS open_items_count FROM item_rows GROUP BY department_id, department_name ORDER BY department_name) x), '[]'::json),
         'open_items_by_section', COALESCE((SELECT json_agg(row_to_json(x)) FROM (SELECT section_id, section_name, department_id, department_name, COUNT(*)::int AS open_items_count FROM item_rows GROUP BY section_id, section_name, department_id, department_name ORDER BY department_name, section_name) x), '[]'::json),
         'open_items_by_requester', COALESCE((SELECT json_agg(row_to_json(x)) FROM (SELECT requester_id, requester_name, department_id, department_name, COUNT(*)::int AS open_items_count FROM item_rows GROUP BY requester_id, requester_name, department_id, department_name ORDER BY requester_name) x), '[]'::json),
         'overdue_by_department', COALESCE((SELECT json_agg(row_to_json(x)) FROM (SELECT department_id, department_name, COUNT(*)::int AS overdue_items FROM item_rows WHERE overdue_flag GROUP BY department_id, department_name ORDER BY department_name) x), '[]'::json),
         'partially_procured_by_department', COALESCE((SELECT json_agg(row_to_json(x)) FROM (SELECT department_id, department_name, COUNT(*)::int AS partially_procured_items FROM item_rows WHERE partially_procured_flag GROUP BY department_id, department_name ORDER BY department_name) x), '[]'::json),
         'emergency_by_department', COALESCE((SELECT json_agg(row_to_json(x)) FROM (SELECT department_id, department_name, COUNT(*)::int AS emergency_items FROM item_rows WHERE emergency_flag GROUP BY department_id, department_name ORDER BY department_name) x), '[]'::json)
       ) AS summary`,
      values
    );
    res.json(rows[0]?.summary || {});
  } catch (err) {
    next(err);
  }
};

const getRowsForMessage = async (body, user) => {
  const itemIds = Array.isArray(body.item_ids) ? body.item_ids.map(Number).filter(Number.isInteger) : [];
  const syntheticQuery = {
    department_id: body.department_id,
    section_id: body.section_id,
    include_completed: 'false',
  };
  const { forbidden, whereSql, values } = buildWhereClause(syntheticQuery, user);
  if (forbidden) return { forbidden: true, rows: [] };
  const extra = [];
  if (itemIds.length) {
    values.push(itemIds);
    extra.push(`item_id = ANY($${values.length}::int[])`);
  }
  const sql = `${baseSelect(`${whereSql}${extra.length ? ` AND ${extra.join(' AND ')}` : ''}`)} SELECT * FROM item_rows ORDER BY item_name`;
  const { rows } = await pool.query(sql, values);
  return { rows };
};

const createFollowUpMessagePreview = async (req, res, next) => {
  try {
    await ensureDepartmentItemFollowUpNotesTable();
    const { rows, forbidden } = await getRowsForMessage(req.body || {}, req.user);
    if (forbidden) return res.status(403).json({ message: 'You do not have access to department requested items.' });
    if (!rows.length) return res.status(404).json({ message: 'No pending items found for the selected scope.' });

    const departmentName = rows[0].department_name || 'Selected';
    const lines = rows.map((item, index) => `${index + 1}. ${item.item_name} - Requested: ${item.requested_quantity} - Purchased: ${item.purchased_quantity} - Remaining: ${item.remaining_quantity} - Request ID: ${item.request_id}`);
    const message = `Dear ${departmentName} Department,\n\nThe following items are currently pending under your purchase requests:\n${lines.join('\n')}\n\nPlease confirm whether these items are still required and advise if any priority has changed.`;
    res.json({ message, message_type: req.body?.message_type || 'whatsapp', item_count: rows.length, items: rows });
  } catch (err) {
    next(err);
  }
};

const createFollowUpNote = async (req, res, next) => {
  try {
    await ensureDepartmentItemFollowUpNotesTable();
    const body = req.body || {};
    const note = String(body.note || '').trim();
    const departmentId = intOrNull(body.department_id);
    const itemIds = Array.isArray(body.item_ids) ? body.item_ids.map(Number).filter(Number.isInteger) : [];
    if (!note || !departmentId || !itemIds.length) {
      return res.status(400).json({ message: 'department_id, item_ids and note are required.' });
    }

    const { rows, forbidden } = await getRowsForMessage(body, req.user);
    if (forbidden) return res.status(403).json({ message: 'You do not have access to department requested items.' });
    const selectedRows = rows.filter(row => itemIds.includes(Number(row.item_id)));
    if (!selectedRows.length) return res.status(404).json({ message: 'No accessible requested items found.' });

    const values = [];
    const placeholders = selectedRows.map(row => {
      const start = values.length;
      values.push(row.request_id, row.item_id, departmentId, row.section_id, req.user?.id || null, note, body.department_response || null, body.next_follow_up_date || null);
      return `($${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, $${start + 7}, $${start + 8})`;
    });

    const { rows: inserted } = await pool.query(
      `INSERT INTO public.department_item_follow_up_notes
        (request_id, requested_item_id, department_id, section_id, created_by, note, department_response, next_follow_up_date)
       VALUES ${placeholders.join(', ')}
       RETURNING *`,
      values
    );
    res.status(201).json({ message: 'Follow-up note saved.', notes: inserted });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getDepartmentRequestedItems,
  getSummary,
  createFollowUpMessagePreview,
  createFollowUpNote,
  buildWhereClause,
  groupRows,
};