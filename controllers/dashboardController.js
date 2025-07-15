//controllers/dashboardController.js
const pool = require('../config/db');

const getDashboardSummary = async (req, res) => {
  try {
    const totalRes = await pool.query('SELECT COUNT(*) FROM requests');
    const approvedRes = await pool.query("SELECT COUNT(*) FROM requests WHERE status = 'Approved'");
    const rejectedRes = await pool.query("SELECT COUNT(*) FROM requests WHERE status = 'Rejected'");
    const pendingRes = await pool.query("SELECT COUNT(*) FROM requests WHERE status = 'Pending'");

    const spendingByMonth = await pool.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        SUM(estimated_cost) AS total_cost
      FROM requests
      WHERE status = 'Approved'
      GROUP BY month
      ORDER BY month
    `);

    const topDepartments = await pool.query(`
      SELECT d.name, COUNT(*) AS request_count
      FROM requests r
      JOIN departments d ON r.department_id = d.id
      JOIN sections s ON d.section_id = s.id
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
    });
  } catch (err) {
    console.error('❌ Failed to load dashboard summary:', err);
    res.status(500).json({ error: 'Dashboard data fetch failed' });
  }
};

module.exports = { getDashboardSummary };