const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');
const ensureRequestedItemApprovalColumns = require('../../utils/ensureRequestedItemApprovalColumns');

const ordinalSuffix = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const printRequest = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const accessRes = await pool.query(
      `SELECT r.*, COALESCE(r.print_count, 0) AS print_count, d.name AS department_name, requester.name AS requester_name, requester.role AS requester_role
       FROM requests r
       LEFT JOIN approvals a ON r.id = a.request_id
      LEFT JOIN departments d ON r.department_id = d.id
      LEFT JOIN users requester ON r.requester_id = requester.id
      WHERE r.id = $1 AND (r.requester_id = $2 OR a.approver_id = $2 OR r.assigned_to = $2)
       LIMIT 1`,
      [id, userId]
    );

    if (accessRes.rowCount === 0)
      return next(createHttpError(404, 'Request not found or access denied'));

    const currentCount = accessRes.rows[0].print_count;

    const updateRes = await pool.query(
      `UPDATE requests SET print_count = $1 WHERE id = $2 RETURNING *`,
      [currentCount + 1, id]
    );

    const request = updateRes.rows[0];

    let finalApproval = null;
    try {
      const finalApprovalRes = await pool.query(
        `SELECT a.approved_at, a.comments, u.name AS approver_name
         FROM approvals a
         LEFT JOIN users u ON a.approver_id = u.id
         WHERE a.request_id = $1 AND a.status = 'Approved'
         ORDER BY a.approval_level DESC, a.approved_at DESC
         LIMIT 1`,
        [id]
      );
      finalApproval = finalApprovalRes.rows[0] || null;
    } catch (error) {
      console.error('⚠️ Failed to fetch final approval details:', error);
    }

    if (request) {
      request.project_name = accessRes.rows[0]?.project_name || null;
      request.department_name = accessRes.rows[0]?.department_name || null;
      request.requester_name = accessRes.rows[0]?.requester_name || null;
      request.requester_role = accessRes.rows[0]?.requester_role || null;
      request.final_approval = finalApproval
        ? {
            approved_at: finalApproval.approved_at,
            approver_name: finalApproval.approver_name || null,
            comments: finalApproval.comments || null,
          }
        : null;
    }
    const count = currentCount + 1;

    let itemsRes;
    if (request.request_type === 'Warehouse Supply') {
      itemsRes = await pool.query(
        `SELECT id, item_name, quantity FROM warehouse_supply_items WHERE request_id = $1`,
        [id]
      );
      await ensureRequestedItemApprovalColumns();
      itemsRes = await pool.query(
        `SELECT
           item_name,
           brand,
           quantity,
           purchased_quantity,
           unit_cost,
           total_cost,
           specs,
           approval_status,
           approval_comments,
           approved_by,
           approved_at
         FROM public.requested_items
         WHERE request_id = $1`,
        [id]
      );
    } else {
      await ensureRequestedItemApprovalColumns();
      itemsRes = await pool.query(
        `SELECT
           item_name,
           brand,
           quantity,
           purchased_quantity,
           unit_cost,
           total_cost,
           specs,
           approval_status,
           approval_comments,
           approved_by,
           approved_at
         FROM public.requested_items
         WHERE request_id = $1`,
        [id]
      );
    }

    let assignedUser = null;
    if (request.assigned_to) {
      const assignedRes = await pool.query(
        `SELECT id, name, role FROM users WHERE id = $1`,
        [request.assigned_to]
      );
      assignedUser = assignedRes.rows[0] || null;
    }

    res.json({
      message: `Request printed for the ${ordinalSuffix(count)} time`,
      request,
      items: itemsRes?.rows || [],
      assigned_user: assignedUser,
      print_count: count,
    });
  } catch (err) {
    console.error('❌ Failed to print request:', err);
    next(createHttpError(500, 'Failed to print request'));
  }
};

module.exports = { printRequest };