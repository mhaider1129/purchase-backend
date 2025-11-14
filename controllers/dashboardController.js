//controllers/dashboardController.js
const pool = require('../config/db');

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
    ] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM requests WHERE request_type <> 'Warehouse Supply'"),
      pool.query(
        "SELECT COUNT(*) FROM requests WHERE LOWER(status) = 'approved' AND request_type <> 'Warehouse Supply'",
      ),
      pool.query(
        "SELECT COUNT(*) FROM requests WHERE LOWER(status) = 'rejected' AND request_type <> 'Warehouse Supply'",
      ),
      pool.query(
        "SELECT COUNT(*) FROM requests WHERE LOWER(status) = 'pending' AND request_type <> 'Warehouse Supply'",
      ),
      pool.query(
        "SELECT COUNT(*) FROM requests WHERE LOWER(status) = 'completed' AND request_type <> 'Warehouse Supply'",
      ),
      pool.query(`
        SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) / 86400 AS avg_days
        FROM requests
        WHERE LOWER(status) = 'approved' AND request_type <> 'Warehouse Supply'
      `),
      pool.query(`
        SELECT AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - created_at))) / 86400 AS avg_days
        FROM requests
        WHERE LOWER(status) = 'pending' AND request_type <> 'Warehouse Supply'
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
        WITH request_costs AS (
          SELECT
            r.id,
            r.created_at,
            CASE
              WHEN r.estimated_cost IS NOT NULL AND r.estimated_cost > 0 THEN r.estimated_cost
              ELSE NULL
            END AS recorded_cost,
            SUM(
              CASE
                WHEN ri.id IS NULL THEN 0
                WHEN ri.purchased_quantity IS NOT NULL AND ri.purchased_quantity > 0 THEN ri.purchased_quantity * COALESCE(ri.unit_cost, 0)
                WHEN ri.quantity IS NOT NULL AND ri.quantity > 0 THEN ri.quantity * COALESCE(ri.unit_cost, 0)
                ELSE 0
              END
            ) AS items_cost
          FROM requests r
          LEFT JOIN requested_items ri ON ri.request_id = r.id
          WHERE LOWER(r.status) IN ('approved', 'completed', 'received')
            AND r.request_type <> 'Warehouse Supply'
          GROUP BY r.id, r.created_at
        )
        SELECT
          TO_CHAR(created_at, 'YYYY-MM') AS month,
          SUM(COALESCE(recorded_cost, items_cost, 0)) AS total_cost
        FROM request_costs
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
        SELECT
          TO_CHAR(created_at, 'YYYY-MM') AS month,
          SUM(CASE WHEN LOWER(status) = 'completed' THEN 1 ELSE 0 END) AS completed_count,
          SUM(CASE WHEN LOWER(status) = 'pending' THEN 1 ELSE 0 END) AS pending_count
        FROM requests
        WHERE request_type <> 'Warehouse Supply'
          AND created_at >= (CURRENT_DATE - INTERVAL '11 months')
        GROUP BY month
        ORDER BY month
      `),
      pool.query(`
        SELECT
          r.id,
          COALESCE(r.justification, 'No justification provided') AS justification,
          COALESCE(d.name, 'Unassigned') AS department,
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - r.created_at)) / 86400 AS age_days
        FROM requests r
        LEFT JOIN departments d ON r.department_id = d.id
        WHERE LOWER(r.status) = 'pending' AND r.request_type <> 'Warehouse Supply'
        ORDER BY age_days DESC
        LIMIT 5
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
      `WITH request_costs AS (
         SELECT
           r.id,
           r.department_id,
           r.created_at,
           CASE
             WHEN r.estimated_cost IS NOT NULL AND r.estimated_cost > 0 THEN r.estimated_cost
             ELSE NULL
           END AS recorded_cost,
           SUM(
             CASE
               WHEN ri.id IS NULL THEN 0
               WHEN ri.purchased_quantity IS NOT NULL AND ri.purchased_quantity > 0 THEN ri.purchased_quantity * COALESCE(ri.unit_cost, 0)
               WHEN ri.quantity IS NOT NULL AND ri.quantity > 0 THEN ri.quantity * COALESCE(ri.unit_cost, 0)
               ELSE 0
             END
           ) AS items_cost
         FROM requests r
         LEFT JOIN requested_items ri ON ri.request_id = r.id
         WHERE LOWER(r.status) IN ('approved', 'completed', 'received')
           AND r.request_type <> 'Warehouse Supply'
           AND EXTRACT(YEAR FROM r.created_at) = $1
         GROUP BY r.id, r.department_id, r.created_at
       )
       SELECT COALESCE(d.name, 'Unassigned') AS department,
              TO_CHAR(rc.created_at, 'YYYY-MM') AS month,
              SUM(COALESCE(rc.recorded_cost, rc.items_cost, 0)) AS total_cost
       FROM request_costs rc
       LEFT JOIN departments d ON rc.department_id = d.id
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

const getLifecycleAnalytics = async (req, res) => {
  if (!req.user.hasPermission('dashboard.view')) {
    return res.status(403).json({ message: 'You do not have permission to view this dashboard' });
  }

  try {
    const avgApprovalRes = await pool.query(`
      SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) / 86400 AS avg_days
      FROM requests
      WHERE status = 'Approved' AND request_type <> 'Warehouse Supply'
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
        SELECT
          ri.request_id,
          MIN(ri.procurement_updated_at) AS po_timestamp
        FROM public.requested_items ri
        WHERE ri.procurement_status IN ('purchased', 'completed')
          AND ri.procurement_updated_at IS NOT NULL
        GROUP BY ri.request_id
      )
      SELECT AVG(EXTRACT(EPOCH FROM (po.po_timestamp - r.created_at))) / 86400 AS avg_days
      FROM po_events po
      JOIN requests r ON po.request_id = r.id
      WHERE r.status = 'Approved'
        AND r.request_type <> 'Warehouse Supply'
    `);

    res.json({
      avg_approval_time_days:
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

module.exports = { getDashboardSummary, getDepartmentMonthlySpending, getLifecycleAnalytics };