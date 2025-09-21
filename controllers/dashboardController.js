//controllers/dashboardController.js
const pool = require('../config/db');

const getDashboardSummary = async (req, res) => {
  try {
    const totalRes = await pool.query("SELECT COUNT(*) FROM requests WHERE request_type <> 'Warehouse Supply'");
    const approvedRes = await pool.query("SELECT COUNT(*) FROM requests WHERE status = 'Approved' AND request_type <> 'Warehouse Supply'");
    const rejectedRes = await pool.query("SELECT COUNT(*) FROM requests WHERE status = 'Rejected' AND request_type <> 'Warehouse Supply'");
    const pendingRes = await pool.query("SELECT COUNT(*) FROM requests WHERE status = 'Pending' AND request_type <> 'Warehouse Supply'");

    const avgApprovalRes = await pool.query(`
      SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) / 86400 AS avg_days
      FROM requests
      WHERE status = 'Approved' AND request_type <> 'Warehouse Supply'
    `);

    const rejectionsByMonthRes = await pool.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        COUNT(*) AS rejected_count
      FROM requests
      WHERE status = 'Rejected' AND request_type <> 'Warehouse Supply'
      GROUP BY month
      ORDER BY month
    `);

    const spendingByMonth = await pool.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        SUM(estimated_cost) AS total_cost
      FROM requests
      WHERE status = 'Approved' AND request_type <> 'Warehouse Supply'
      GROUP BY month
      ORDER BY month
    `);

    const topDepartments = await pool.query(`
      SELECT d.name, COUNT(*) AS request_count
      FROM requests r
      JOIN departments d ON r.department_id = d.id
      LEFT JOIN sections s ON r.section_id = s.id
      WHERE r.request_type <> 'Warehouse Supply'
      GROUP BY d.name
      ORDER BY request_count DESC
      LIMIT 5
    `);

    res.json({
      total_requests: parseInt(totalRes.rows[0].count),
      approved_requests: parseInt(approvedRes.rows[0].count),
      rejected_requests: parseInt(rejectedRes.rows[0].count),
      pending_requests: parseInt(pendingRes.rows[0].count),
      spending_by_month: spendingByMonth.rows,
      top_departments: topDepartments.rows,
      avg_approval_time_days: parseFloat(avgApprovalRes.rows[0].avg_days) || 0,
      rejections_by_month: rejectionsByMonthRes.rows,
    });
  } catch (err) {
    console.error('❌ Failed to load dashboard summary:', err);
    res.status(500).json({ error: 'Dashboard data fetch failed' });
  }
};

const getDepartmentMonthlySpending = async (req, res) => {
  const { role } = req.user;
  if (!['admin', 'SCM'].includes(role)) {
    return res.status(403).json({ message: 'Unauthorized' });
  }

  const year = parseInt(req.query.year, 10) || new Date().getFullYear();

  try {
    const { rows } = await pool.query(
      `SELECT d.name AS department,
              TO_CHAR(r.created_at, 'YYYY-MM') AS month,
              SUM(r.estimated_cost) AS total_cost
       FROM requests r
       JOIN departments d ON r.department_id = d.id
       WHERE r.status = 'Approved'
         AND r.request_type <> 'Warehouse Supply'
         AND EXTRACT(YEAR FROM r.created_at) = $1
       GROUP BY d.name, month
       ORDER BY d.name, month`,
      [year]
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to fetch department spending:', err);
    res.status(500).json({ error: 'Failed to fetch department spending' });
  }
};

const getLifecycleAnalytics = async (req, res) => {
  const { role } = req.user;
  if (!['admin', 'SCM'].includes(role)) {
    return res.status(403).json({ message: 'Unauthorized' });
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
      FROM requested_items ri
      JOIN requests r ON ri.request_id = r.id
      WHERE r.status = 'Approved'
      GROUP BY 1
      ORDER BY total_cost DESC
    `);

    res.json({
      avg_approval_time_days:
        parseFloat(avgApprovalRes.rows[0].avg_days) || 0,
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