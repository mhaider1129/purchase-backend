//controllers/dashboardController.js
const pool = require('../config/db');

const WORKLOAD_DEFAULTS = {
  pendingStatuses: ['Pending', 'On Hold'],
  approvedStatus: 'Approved',
  completionWindowDays: 30,
};

const parseCsv = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const getWorkloadFilters = (query = {}) => {
  const pendingStatuses = parseCsv(query.pending_statuses);
  const approvedStatus = String(query.approved_status || WORKLOAD_DEFAULTS.approvedStatus).trim() || WORKLOAD_DEFAULTS.approvedStatus;
  const completionWindowDays = Number.parseInt(query.completion_window_days, 10);

  return {
    pendingStatuses: pendingStatuses.length ? pendingStatuses : WORKLOAD_DEFAULTS.pendingStatuses,
    approvedStatus,
    completionWindowDays:
      Number.isFinite(completionWindowDays) && completionWindowDays > 0
        ? Math.min(completionWindowDays, 365)
        : WORKLOAD_DEFAULTS.completionWindowDays,
  };
};

const isProcuredItemCondition = `(
  LOWER(COALESCE(ri.procurement_status, '')) IN ('purchased', 'completed', 'received', 'fulfilled')
  OR COALESCE(ri.purchased_quantity, 0) > 0
  OR COALESCE(ri.received_quantity, 0) > 0
)`;

const itemActualCostExpression = `CASE
  WHEN COALESCE(ri.purchased_quantity, 0) > 0 THEN COALESCE(ri.purchased_quantity, 0) * COALESCE(ri.unit_cost, 0)
  WHEN COALESCE(ri.received_quantity, 0) > 0 THEN COALESCE(ri.received_quantity, 0) * COALESCE(ri.unit_cost, 0)
  WHEN ${isProcuredItemCondition} THEN COALESCE(ri.total_cost, ri.quantity * COALESCE(ri.unit_cost, 0), 0)
  ELSE 0
END`;

const requestValueExpression = `CASE
  WHEN r.estimated_cost IS NOT NULL AND r.estimated_cost > 0 THEN r.estimated_cost
  ELSE COALESCE(SUM(COALESCE(ri.total_cost, ri.quantity * COALESCE(ri.unit_cost, 0), 0)), 0)
END`;

const requestProcurementRollup = `
  SELECT
    r.id,
    r.department_id,
    r.created_at,
    r.updated_at,
    LOWER(COALESCE(r.status, '')) AS request_status,
    COUNT(ri.id) AS item_count,
    COUNT(ri.id) FILTER (WHERE ${isProcuredItemCondition}) AS procured_item_count,
    COALESCE(SUM(${itemActualCostExpression}), 0) AS actual_procured_cost
  FROM requests r
  LEFT JOIN requested_items ri ON ri.request_id = r.id
  WHERE r.request_type <> 'Warehouse Supply'
  GROUP BY r.id, r.department_id, r.created_at, r.updated_at, LOWER(COALESCE(r.status, ''))
`;

const isRequestProcurementPendingCondition = `(
  request_status = 'pending'
  OR (
    request_status = 'approved'
    AND (item_count = 0 OR procured_item_count < item_count)
  )
)`;

const isRequestProcurementCompletedCondition = `(
  request_status IN ('completed', 'received')
  OR (
    request_status = 'approved'
    AND item_count > 0
    AND procured_item_count = item_count
  )
)`;

const getDashboardSummary = async (req, res) => {
  try {
    const [
      totalRes,
      approvedRes,
      rejectedRes,
      pendingRes,
      completedRes,
      avgApprovalRes,
      avgPendingAgeRes,
      rejectionsByMonthRes,
      spendingByMonth,
      topDepartments,
      pendingVsCompletedTrendRes,
      oldestPendingRes,
      procurementBacklogByStageRes,
      pendingAgingBucketsRes,
      departmentDemandVsProcuredRes,
      dataQualityAlertsRes,
    ] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM requests WHERE request_type <> 'Warehouse Supply'"),
      pool.query(
        "SELECT COUNT(*) FROM requests WHERE LOWER(status) = 'approved' AND request_type <> 'Warehouse Supply'",
      ),
      pool.query(
        "SELECT COUNT(*) FROM requests WHERE LOWER(status) = 'rejected' AND request_type <> 'Warehouse Supply'",
      ),
      pool.query(`
        WITH request_rollup AS (${requestProcurementRollup})
        SELECT COUNT(*) FROM request_rollup
        WHERE ${isRequestProcurementPendingCondition}
      `),
      pool.query(`
        WITH request_rollup AS (${requestProcurementRollup})
        SELECT COUNT(*) FROM request_rollup
        WHERE ${isRequestProcurementCompletedCondition}
      `),
      pool.query(`
        SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) / 86400 AS avg_days
        FROM requests
        WHERE LOWER(status) = 'approved' AND request_type <> 'Warehouse Supply'
      `),
      pool.query(`
        WITH request_rollup AS (${requestProcurementRollup})
        SELECT AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - created_at))) / 86400 AS avg_days
        FROM request_rollup
        WHERE ${isRequestProcurementPendingCondition}
      `),
      pool.query(`
        SELECT
          TO_CHAR(created_at, 'YYYY-MM') AS month,
          COUNT(*) AS rejected_count
        FROM requests
        WHERE LOWER(status) = 'rejected' AND request_type <> 'Warehouse Supply'
        GROUP BY month
        ORDER BY month
      `),
      pool.query(`
        SELECT
          TO_CHAR(COALESCE(ri.procurement_updated_at, r.updated_at, r.created_at), 'YYYY-MM') AS month,
          SUM(${itemActualCostExpression}) AS total_cost
        FROM requests r
        JOIN requested_items ri ON ri.request_id = r.id
        WHERE r.request_type <> 'Warehouse Supply'
          AND ${isProcuredItemCondition}
        GROUP BY month
        ORDER BY month
      `),
      pool.query(`
        SELECT d.name, COUNT(*) AS request_count
        FROM requests r
        JOIN departments d ON r.department_id = d.id
        LEFT JOIN sections s ON r.section_id = s.id
        WHERE r.request_type <> 'Warehouse Supply'
        GROUP BY d.name
        ORDER BY request_count DESC
        LIMIT 5
      `),
      pool.query(`
        WITH request_rollup AS (${requestProcurementRollup})
        SELECT
          TO_CHAR(created_at, 'YYYY-MM') AS month,
          SUM(CASE WHEN ${isRequestProcurementCompletedCondition} THEN 1 ELSE 0 END) AS completed_count,
          SUM(CASE WHEN ${isRequestProcurementPendingCondition} THEN 1 ELSE 0 END) AS pending_count
        FROM request_rollup
        WHERE created_at >= (CURRENT_DATE - INTERVAL '11 months')
        GROUP BY month
        ORDER BY month
      `),
      pool.query(`
        WITH request_rollup AS (${requestProcurementRollup})
        SELECT
          rr.id,
          COALESCE(r.justification, 'No justification provided') AS justification,
          COALESCE(d.name, 'Unassigned') AS department,
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - rr.created_at)) / 86400 AS age_days,
          rr.item_count,
          rr.procured_item_count
        FROM request_rollup rr
        JOIN requests r ON r.id = rr.id
        LEFT JOIN departments d ON rr.department_id = d.id
        WHERE ${isRequestProcurementPendingCondition}
        ORDER BY age_days DESC
        LIMIT 5
      `),
      pool.query(`
        WITH request_rollup AS (${requestProcurementRollup}), staged AS (
          SELECT
            CASE
              WHEN request_status = 'pending' THEN 'Pending approval'
              WHEN request_status = 'approved' AND item_count = 0 THEN 'Approved - no items'
              WHEN request_status = 'approved' AND procured_item_count = 0 THEN 'Approved - not started'
              WHEN request_status = 'approved' AND procured_item_count < item_count THEN 'Partially procured'
              WHEN request_status = 'approved' AND procured_item_count = item_count THEN 'Ready to close'
              ELSE 'Other pending'
            END AS stage,
            actual_procured_cost
          FROM request_rollup
          WHERE ${isRequestProcurementPendingCondition}
        )
        SELECT stage, COUNT(*) AS request_count, SUM(actual_procured_cost) AS procured_cost
        FROM staged
        GROUP BY stage
        ORDER BY request_count DESC, stage
      `),
      pool.query(`
        WITH request_rollup AS (${requestProcurementRollup}), aged AS (
          SELECT
            CASE
              WHEN CURRENT_TIMESTAMP - created_at <= INTERVAL '7 days' THEN '0-7 days'
              WHEN CURRENT_TIMESTAMP - created_at <= INTERVAL '14 days' THEN '8-14 days'
              WHEN CURRENT_TIMESTAMP - created_at <= INTERVAL '30 days' THEN '15-30 days'
              WHEN CURRENT_TIMESTAMP - created_at <= INTERVAL '60 days' THEN '31-60 days'
              ELSE '60+ days'
            END AS bucket,
            CASE
              WHEN CURRENT_TIMESTAMP - created_at <= INTERVAL '7 days' THEN 1
              WHEN CURRENT_TIMESTAMP - created_at <= INTERVAL '14 days' THEN 2
              WHEN CURRENT_TIMESTAMP - created_at <= INTERVAL '30 days' THEN 3
              WHEN CURRENT_TIMESTAMP - created_at <= INTERVAL '60 days' THEN 4
              ELSE 5
            END AS sort_order,
            actual_procured_cost
          FROM request_rollup
          WHERE ${isRequestProcurementPendingCondition}
        )
        SELECT bucket, COUNT(*) AS request_count, SUM(actual_procured_cost) AS procured_cost
        FROM aged
        GROUP BY bucket, sort_order
        ORDER BY sort_order
      `),
      pool.query(`
        WITH request_values AS (
          SELECT
            r.id,
            r.department_id,
            r.created_at,
            LOWER(COALESCE(r.status, '')) AS status,
            ${requestValueExpression} AS submitted_cost,
            COALESCE(SUM(${itemActualCostExpression}), 0) AS actual_procured_cost
          FROM requests r
          LEFT JOIN requested_items ri ON ri.request_id = r.id
          WHERE r.request_type <> 'Warehouse Supply'
            AND r.created_at >= (CURRENT_DATE - INTERVAL '11 months')
          GROUP BY r.id, r.department_id, r.created_at, LOWER(COALESCE(r.status, ''))
        )
        SELECT
          COALESCE(d.name, 'Unassigned') AS department,
          TO_CHAR(rv.created_at, 'YYYY-MM') AS month,
          SUM(rv.submitted_cost) AS submitted_cost,
          SUM(rv.submitted_cost) FILTER (WHERE rv.status IN ('approved', 'completed', 'received')) AS approved_cost,
          SUM(rv.actual_procured_cost) AS actual_procured_cost,
          COUNT(*) AS request_count
        FROM request_values rv
        LEFT JOIN departments d ON rv.department_id = d.id
        GROUP BY department, month
        ORDER BY month, department
      `),
      pool.query(`
        WITH issue_counts AS (
          SELECT 'approved_no_items' AS issue_key, 'Approved requests without items' AS issue_label, COUNT(*) AS issue_count
          FROM requests r
          WHERE LOWER(COALESCE(r.status, '')) = 'approved'
            AND r.request_type <> 'Warehouse Supply'
            AND NOT EXISTS (SELECT 1 FROM requested_items ri WHERE ri.request_id = r.id)
          UNION ALL
          SELECT 'procured_zero_cost', 'Procured items with zero unit cost', COUNT(*)
          FROM requests r
          JOIN requested_items ri ON ri.request_id = r.id
          WHERE r.request_type <> 'Warehouse Supply'
            AND ${isProcuredItemCondition}
            AND COALESCE(ri.unit_cost, 0) = 0
          UNION ALL
          SELECT 'purchased_zero_quantity', 'Purchased/completed items with zero quantity', COUNT(*)
          FROM requests r
          JOIN requested_items ri ON ri.request_id = r.id
          WHERE r.request_type <> 'Warehouse Supply'
            AND LOWER(COALESCE(ri.procurement_status, '')) IN ('purchased', 'completed', 'received')
            AND COALESCE(ri.purchased_quantity, 0) = 0
            AND COALESCE(ri.received_quantity, 0) = 0
          UNION ALL
          SELECT 'received_over_purchased', 'Received quantity greater than purchased quantity', COUNT(*)
          FROM requests r
          JOIN requested_items ri ON ri.request_id = r.id
          WHERE r.request_type <> 'Warehouse Supply'
            AND COALESCE(ri.received_quantity, 0) > COALESCE(NULLIF(ri.purchased_quantity, 0), ri.quantity, 0)
          UNION ALL
          SELECT 'completed_unprocured_items', 'Completed requests with unprocured items', COUNT(*)
          FROM requests r
          JOIN requested_items ri ON ri.request_id = r.id
          WHERE LOWER(COALESCE(r.status, '')) IN ('completed', 'received')
            AND r.request_type <> 'Warehouse Supply'
            AND NOT ${isProcuredItemCondition}
          UNION ALL
          SELECT 'missing_department', 'Requests without a department', COUNT(*)
          FROM requests r
          WHERE r.request_type <> 'Warehouse Supply'
            AND r.department_id IS NULL
        )
        SELECT issue_key, issue_label, issue_count
        FROM issue_counts
        WHERE issue_count > 0
        ORDER BY issue_count DESC, issue_label
      `),
    ]);

    const totalRequests = parseInt(totalRes.rows[0].count, 10);
    const pendingRequests = parseInt(pendingRes.rows[0].count, 10);
    const completedRequests = parseInt(completedRes.rows[0].count, 10);
    const actionableTotal = pendingRequests + completedRequests;
    const completionRate = actionableTotal ? (completedRequests / actionableTotal) * 100 : 0;

    res.json({
      total_requests: totalRequests,
      approved_requests: parseInt(approvedRes.rows[0].count, 10),
      rejected_requests: parseInt(rejectedRes.rows[0].count, 10),
      pending_requests: pendingRequests,
      completed_requests: completedRequests,
      completion_rate: completionRate,
      spending_by_month: spendingByMonth.rows.map((row) => ({
        month: row.month,
        total_cost: parseFloat(row.total_cost) || 0,
      })),
      top_departments: topDepartments.rows,
      avg_approval_time_days: parseFloat(avgApprovalRes.rows[0].avg_days) || 0,
      avg_pending_age_days: parseFloat(avgPendingAgeRes.rows[0].avg_days) || 0,
      rejections_by_month: rejectionsByMonthRes.rows,
      pending_vs_completed_trend: pendingVsCompletedTrendRes.rows.map((row) => ({
        month: row.month,
        completed_count: parseInt(row.completed_count, 10),
        pending_count: parseInt(row.pending_count, 10),
      })),
      oldest_pending_requests: oldestPendingRes.rows.map((row) => ({
        id: row.id,
        justification: row.justification,
        department: row.department,
        age_days: parseFloat(row.age_days) || 0,
      })),
      procurement_backlog_by_stage: procurementBacklogByStageRes.rows.map((row) => ({
        stage: row.stage,
        request_count: parseInt(row.request_count, 10) || 0,
        procured_cost: parseFloat(row.procured_cost) || 0,
      })),
      pending_aging_buckets: pendingAgingBucketsRes.rows.map((row) => ({
        bucket: row.bucket,
        request_count: parseInt(row.request_count, 10) || 0,
        procured_cost: parseFloat(row.procured_cost) || 0,
      })),
      department_demand_vs_procured: departmentDemandVsProcuredRes.rows.map((row) => ({
        department: row.department,
        month: row.month,
        submitted_cost: parseFloat(row.submitted_cost) || 0,
        approved_cost: parseFloat(row.approved_cost) || 0,
        actual_procured_cost: parseFloat(row.actual_procured_cost) || 0,
        request_count: parseInt(row.request_count, 10) || 0,
      })),
      procurement_value_completion_rate: (() => {
        const totals = departmentDemandVsProcuredRes.rows.reduce(
          (acc, row) => ({
            approved: acc.approved + (parseFloat(row.approved_cost) || 0),
            procured: acc.procured + (parseFloat(row.actual_procured_cost) || 0),
          }),
          { approved: 0, procured: 0 }
        );
        return totals.approved ? (totals.procured / totals.approved) * 100 : 0;
      })(),
      data_quality_alerts: dataQualityAlertsRes.rows.map((row) => ({
        issue_key: row.issue_key,
        issue_label: row.issue_label,
        issue_count: parseInt(row.issue_count, 10) || 0,
      })),
    });
  } catch (err) {
    console.error('❌ Failed to load dashboard summary:', err);
    res.status(500).json({ error: 'Dashboard data fetch failed' });
  }
};

const getDepartmentMonthlySpending = async (req, res) => {
  if (!req.user.hasPermission('dashboard.view')) {
    return res.status(403).json({ message: 'You do not have permission to view this dashboard' });
  }

  const year = parseInt(req.query.year, 10) || new Date().getFullYear();

  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(d.name, 'Unassigned') AS department,
              TO_CHAR(COALESCE(ri.procurement_updated_at, r.updated_at, r.created_at), 'YYYY-MM') AS month,
              SUM(${itemActualCostExpression}) AS total_cost
       FROM requests r
       JOIN requested_items ri ON ri.request_id = r.id
       LEFT JOIN departments d ON r.department_id = d.id
       WHERE r.request_type <> 'Warehouse Supply'
         AND ${isProcuredItemCondition}
         AND EXTRACT(YEAR FROM COALESCE(ri.procurement_updated_at, r.updated_at, r.created_at)) = $1
       GROUP BY department, month
       ORDER BY department, month`,
      [year]
    );
    res.json(
      rows.map((row) => ({
        department: row.department,
        month: row.month,
        total_cost: parseFloat(row.total_cost) || 0,
      }))
    );
  } catch (err) {
    console.error('❌ Failed to fetch department spending:', err);
    res.status(500).json({ error: 'Failed to fetch department spending' });
  }
};

const getDepartmentMonthlyRequestCosts = async (req, res) => {
  if (!req.user.hasPermission('dashboard.view')) {
    return res.status(403).json({ message: 'You do not have permission to view this dashboard' });
  }

  const year = parseInt(req.query.year, 10) || new Date().getFullYear();

  try {
    const { rows } = await pool.query(
      `WITH request_costs AS (
         SELECT
           r.id,
           r.department_id,
           r.created_at,
           LOWER(COALESCE(r.status, '')) AS status,
           ${requestValueExpression} AS request_cost
         FROM requests r
         LEFT JOIN requested_items ri ON ri.request_id = r.id
         WHERE r.request_type <> 'Warehouse Supply'
           AND LOWER(COALESCE(r.status, '')) IN ('approved', 'rejected')
           AND EXTRACT(YEAR FROM r.created_at) = $1
         GROUP BY r.id, r.department_id, r.created_at, LOWER(COALESCE(r.status, ''))
       )
       SELECT
         COALESCE(d.name, 'Unassigned') AS department,
         TO_CHAR(rc.created_at, 'YYYY-MM') AS month,
         SUM(rc.request_cost) FILTER (WHERE rc.status = 'approved') AS approved_cost,
         SUM(rc.request_cost) FILTER (WHERE rc.status = 'rejected') AS rejected_cost,
         COUNT(*) FILTER (WHERE rc.status = 'approved') AS approved_count,
         COUNT(*) FILTER (WHERE rc.status = 'rejected') AS rejected_count,
         SUM(rc.request_cost) AS total_cost
       FROM request_costs rc
       LEFT JOIN departments d ON rc.department_id = d.id
       GROUP BY department, month
       ORDER BY month, department`,
      [year]
    );

    res.json(
      rows.map((row) => ({
        department: row.department,
        month: row.month,
        approved_cost: parseFloat(row.approved_cost) || 0,
        rejected_cost: parseFloat(row.rejected_cost) || 0,
        total_cost: parseFloat(row.total_cost) || 0,
        approved_count: parseInt(row.approved_count, 10) || 0,
        rejected_count: parseInt(row.rejected_count, 10) || 0,
      }))
    );
  } catch (err) {
    console.error('❌ Failed to fetch department request costs:', err);
    res.status(500).json({ error: 'Failed to fetch department request costs' });
  }
};

const getLifecycleAnalytics = async (req, res) => {
  if (!req.user.hasPermission('dashboard.view')) {
    return res.status(403).json({ message: 'You do not have permission to view this dashboard' });
  }

  try {
    const avgApprovalRes = await pool.query(`
      WITH final_approvals AS (
        SELECT request_id, MAX(approved_at) AS final_approved_at
        FROM approvals
        WHERE status = 'Approved' AND approved_at IS NOT NULL
        GROUP BY request_id
      )
      SELECT AVG(EXTRACT(EPOCH FROM (fa.final_approved_at - r.created_at))) / 86400 AS avg_days
      FROM final_approvals fa
      JOIN requests r ON r.id = fa.request_id
      WHERE LOWER(r.status) IN ('approved', 'completed', 'received')
        AND r.request_type <> 'Warehouse Supply'
    `);

    const stageDurationRes = await pool.query(`
      SELECT a.approval_level,
             AVG(EXTRACT(EPOCH FROM (a.approved_at - r.created_at))) / 86400 AS avg_days
      FROM approvals a
      JOIN requests r ON a.request_id = r.id
      WHERE a.status = 'Approved'
      GROUP BY a.approval_level
      ORDER BY a.approval_level
    `);

    const stageDurations = stageDurationRes.rows.map((r) => ({
      stage: r.approval_level,
      avg_days: parseFloat(r.avg_days) || 0,
    }));
    const bottleneck = stageDurations.reduce(
      (max, cur) => (cur.avg_days > (max?.avg_days || 0) ? cur : max),
      null,
    );

    const spendRes = await pool.query(`
      SELECT COALESCE(ri.item_name, 'Uncategorized') AS category, SUM(ri.total_cost) AS total_cost
      FROM public.requested_items ri
      JOIN requests r ON ri.request_id = r.id
      WHERE LOWER(r.status) IN ('approved', 'completed', 'received')
      GROUP BY 1
      ORDER BY total_cost DESC
    `);

    const prToPoRes = await pool.query(`
      WITH po_events AS (
        SELECT request_id, MIN(created_at) AS po_timestamp
        FROM public.purchase_orders
        WHERE request_id IS NOT NULL
          AND status <> 'PO_CANCELLED'
        GROUP BY request_id
        UNION ALL
        SELECT
          ri.request_id,
          MIN(ri.procurement_updated_at) AS po_timestamp
        FROM public.requested_items ri
        WHERE ri.procurement_status IN ('purchased', 'completed')
          AND ri.procurement_updated_at IS NOT NULL
        GROUP BY ri.request_id
      ), first_po_events AS (
        SELECT request_id, MIN(po_timestamp) AS po_timestamp
        FROM po_events
        GROUP BY request_id
      )
      SELECT AVG(EXTRACT(EPOCH FROM (po.po_timestamp - r.created_at))) / 86400 AS avg_days
      FROM first_po_events po
      JOIN requests r ON po.request_id = r.id
      WHERE LOWER(r.status) IN ('approved', 'completed', 'received')
        AND r.request_type <> 'Warehouse Supply'
    `);

    res.json({
      avg_approval_time_days:
        parseFloat(avgApprovalRes.rows[0].avg_days) || 0,
      avg_pr_to_final_approval_days:
        parseFloat(avgApprovalRes.rows[0].avg_days) || 0,
      avg_pr_to_po_cycle_days:
        parseFloat(prToPoRes.rows[0]?.avg_days) || 0,
      stage_durations: stageDurations,
      bottleneck_stage: bottleneck,
      spend_by_category: spendRes.rows.map((r) => ({
        category: r.category,
        total_cost: parseFloat(r.total_cost),
      })),
    });
  } catch (err) {
    console.error('❌ Failed to fetch lifecycle analytics:', err);
    res.status(500).json({ error: 'Failed to fetch lifecycle analytics' });
  }
};

const getWorkloadAnalysis = async (req, res) => {
  if (!req.user.hasPermission('dashboard.view')) {
    return res.status(403).json({ message: 'You do not have permission to view this dashboard' });
  }

  try {
    const filters = getWorkloadFilters(req.query);
    const [backlogSummaryRes, userWorkloadRes, levelBacklogRes, departmentBacklogRes, completionTrendRes] =
      await Promise.all([
        pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE a.status = ANY($1) AND a.is_active = TRUE) AS active_pending,
            COUNT(*) FILTER (WHERE a.status = 'On Hold' AND a.is_active = TRUE) AS on_hold,
            COUNT(*) FILTER (WHERE a.status = ANY($1) AND a.is_active = TRUE AND a.is_urgent = TRUE) AS urgent_pending,
            AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - r.created_at)) / 86400)
              FILTER (WHERE a.status = ANY($1) AND a.is_active = TRUE) AS avg_age_days
          FROM approvals a
          JOIN requests r ON a.request_id = r.id
        `, [filters.pendingStatuses]),
        pool.query(`
          SELECT
            a.approver_id,
            COALESCE(u.name, 'Unassigned') AS approver_name,
            COALESCE(u.role, 'Unknown') AS role,
            COALESCE(d.name, 'Unassigned') AS department,
            COUNT(*) FILTER (WHERE a.status = ANY($1) AND a.is_active = TRUE) AS pending_count,
            COUNT(*) FILTER (WHERE a.status = 'On Hold' AND a.is_active = TRUE) AS on_hold_count,
            COUNT(*) FILTER (WHERE a.status = ANY($1) AND a.is_active = TRUE AND a.is_urgent = TRUE) AS urgent_count,
            AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - r.created_at)) / 86400)
              FILTER (WHERE a.status = ANY($1) AND a.is_active = TRUE) AS avg_age_days
          FROM approvals a
          LEFT JOIN users u ON a.approver_id = u.id
          JOIN requests r ON a.request_id = r.id
          LEFT JOIN departments d ON r.department_id = d.id
          WHERE a.is_active = TRUE
            AND a.status = ANY($1)
          GROUP BY a.approver_id, approver_name, role, department
          ORDER BY pending_count DESC, urgent_count DESC
        `, [filters.pendingStatuses]),
        pool.query(`
          SELECT
            a.approval_level,
            COUNT(*) AS pending_count,
            COUNT(*) FILTER (WHERE a.is_urgent = TRUE) AS urgent_count,
            AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - r.created_at)) / 86400) AS avg_age_days
          FROM approvals a
          JOIN requests r ON a.request_id = r.id
          WHERE a.is_active = TRUE
            AND a.status = ANY($1)
          GROUP BY a.approval_level
          ORDER BY a.approval_level
        `, [filters.pendingStatuses]),
        pool.query(`
          SELECT
            COALESCE(d.name, 'Unassigned') AS department,
            COUNT(*) AS pending_count,
            COUNT(*) FILTER (WHERE r.is_urgent) AS urgent_count,
            AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - r.created_at)) / 86400) AS avg_age_days
          FROM approvals a
          JOIN requests r ON a.request_id = r.id
          LEFT JOIN departments d ON r.department_id = d.id
          WHERE a.is_active = TRUE
            AND a.status = ANY($1)
          GROUP BY department
          ORDER BY pending_count DESC
        `, [filters.pendingStatuses]),
        pool.query(`
          SELECT
            TO_CHAR(DATE_TRUNC('day', a.approved_at), 'YYYY-MM-DD') AS day,
            COUNT(*) AS approvals_completed
          FROM approvals a
          WHERE a.status = $1
            AND a.approved_at >= (CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day')
          GROUP BY day
          ORDER BY day
        `, [filters.approvedStatus, filters.completionWindowDays]),
      ]);

    const summary = backlogSummaryRes.rows[0] || {};

    res.json({
      total_active: Number(summary.active_pending || 0),
      on_hold: Number(summary.on_hold || 0),
      urgent_active: Number(summary.urgent_pending || 0),
      avg_age_days: parseFloat(summary.avg_age_days) || 0,
      workload_by_user: userWorkloadRes.rows.map((row) => ({
        approver_id: row.approver_id,
        approver_name: row.approver_name,
        role: row.role,
        department: row.department,
        pending_count: Number(row.pending_count || 0),
        on_hold_count: Number(row.on_hold_count || 0),
        urgent_count: Number(row.urgent_count || 0),
        avg_age_days: parseFloat(row.avg_age_days) || 0,
      })),
      workload_by_level: levelBacklogRes.rows.map((row) => ({
        approval_level: Number(row.approval_level),
        pending_count: Number(row.pending_count || 0),
        urgent_count: Number(row.urgent_count || 0),
        avg_age_days: parseFloat(row.avg_age_days) || 0,
      })),
      backlog_by_department: departmentBacklogRes.rows.map((row) => ({
        department: row.department,
        pending_count: Number(row.pending_count || 0),
        urgent_count: Number(row.urgent_count || 0),
        avg_age_days: parseFloat(row.avg_age_days) || 0,
      })),
      filters,
      completions_trend: completionTrendRes.rows.map((row) => ({
        day: row.day,
        approvals_completed: Number(row.approvals_completed || 0),
      })),
    });
  } catch (err) {
    console.error('❌ Failed to fetch workload analysis:', err);
    res.status(500).json({ error: 'Failed to fetch workload analysis' });
  }
};

module.exports = {
  getDashboardSummary,
  getDepartmentMonthlySpending,
  getDepartmentMonthlyRequestCosts,
  getLifecycleAnalytics,
  getWorkloadAnalysis,
};