// ✅ All purchase request-related routes
const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
router.use(authenticateUser); // 🔐 Protect all routes
const { getCompletedAssignedRequests } = require('../controllers/requests/procurementHistoryController');
const upload = require('../middleware/upload');

// 🧩 Controllers
const {
  createRequest,
  getAllRequests,
  getMyRequests,
  getMyMaintenanceRequests,
  getPendingApprovals,
  getAssignedRequests,
  getApprovalHistory,
  getProcurementUsers,
  getRequestDetails,
  getRequestItemsOnly,
  getRequestLogs,
  printRequest,
  updateApprovalStatus,
  assignRequestToProcurement,
  approveMaintenanceRequest,
  getPendingMaintenanceApprovals,
  markRequestAsCompleted,
  updateRequestCost,
  getClosedRequests,
  getAuditApprovedRejectedRequests
} = require('../controllers/requestsController');

const {
  getAllIncomplete,
  getMedicalIncomplete,
  getOperationalIncomplete
} = require('../controllers/requests/incompleteController');

const { generateRfx } = require('../controllers/requestsController');

const assignRequestToUser = require('../controllers/requests/assignRequestController');

const { Parser } = require('json2csv');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');

// ==========================
// 📦 Core Request Operations
// ==========================

router.post('/', upload.any(), createRequest); // Create new request with optional attachments
router.get('/', getAllRequests); // Admin/SCM view all
router.get('/my', getMyRequests); // My submitted requests
router.get('/my-maintenance', getMyMaintenanceRequests); // Maintenance only
router.get('/pending-approvals', getPendingApprovals); // My approvals
router.get('/assigned', getAssignedRequests); // Assigned to me (procurement)
router.get('/completed-assigned', getCompletedAssignedRequests); // Procurement completed history
router.get('/closed', getClosedRequests); // Completed or rejected requests
router.get('/audit/approved-rejected', getAuditApprovedRejectedRequests); // Audit view
router.get('/approval-history', getApprovalHistory); // My approval history
router.get('/procurement-users', getProcurementUsers); // For SCM dropdown
router.patch('/:id/mark-completed', authenticateUser, markRequestAsCompleted);
router.put('/:id/cost', authenticateUser, updateRequestCost);


// ==========================
// 🛠️ Maintenance Workflow
// ==========================
router.get('/pending-maintenance-approvals', getPendingMaintenanceApprovals);
router.post('/approve-maintenance', approveMaintenanceRequest);

// ==========================
// ⏳ Incomplete Request Views
// ==========================
router.get('/incomplete', getAllIncomplete); // Admin/SCM
router.get('/incomplete/medical', getMedicalIncomplete); // CMO
router.get('/incomplete/operational', getOperationalIncomplete); // COO

// ==========================
// 📤 Export to CSV / PDF
// ==========================
const buildFilteredQuery = (queryParams) => {
  const { request_type, search, from_date, to_date, status, department_id } = queryParams;
  let sql = `SELECT r.*, u.name AS assigned_user_name, d.name AS department_name FROM requests r`;
  sql += ` LEFT JOIN users u ON r.assigned_to = u.id`;
  sql += ` JOIN departments d ON r.department_id = d.id WHERE 1=1`;
  const values = [];

  if (request_type) {
    values.push(request_type);
    sql += ` AND r.request_type = $${values.length}`;
  }

  if (search) {
    values.push(`%${search}%`);
    sql += ` AND (
      r.justification ILIKE $${values.length}
      OR r.request_type ILIKE $${values.length}
      OR CAST(r.id AS TEXT) ILIKE $${values.length}
      OR EXISTS (
        SELECT 1 FROM requested_items ri
        WHERE ri.request_id = r.id AND ri.item_name ILIKE $${values.length}
      )
    )`;
  }

  if (from_date) {
    values.push(from_date);
    sql += ` AND r.created_at >= $${values.length}`;
  }

  if (to_date) {
    values.push(to_date);
    sql += ` AND r.created_at <= $${values.length}`;
  }

    if (status) {
    values.push(status);
    sql += ` AND r.status = $${values.length}`;
  }

  if (department_id) {
    values.push(department_id);
    sql += ` AND r.department_id = $${values.length}`;
  }

  sql += ' ORDER BY r.created_at DESC';
  return { sql, values };
};

// 📤 CSV
router.get('/export/csv', async (req, res) => {
  try {
    const { sql, values } = buildFilteredQuery(req.query);
    const result = await pool.query(sql, values);
    const parser = new Parser();
    const csv = parser.parse(result.rows);
    res.header('Content-Type', 'text/csv');
    res.attachment('purchase_requests.csv');
    return res.send(csv);
  } catch (err) {
    console.error('❌ CSV export failed:', err);
    res.status(500).json({ error: 'CSV export failed' });
  }
});

// 📤 PDF
router.get('/export/pdf', async (req, res) => {
  try {
    const { sql, values } = buildFilteredQuery(req.query);
    const result = await pool.query(sql, values);

    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="purchase_requests.pdf"');
    doc.pipe(res);

    doc.fontSize(16).text('Purchase Requests Report', { align: 'center' }).moveDown();
    result.rows.forEach((req, idx) => {
      doc.fontSize(10).text(`ID: ${req.id}`);
      doc.text(`Type: ${req.request_type}`);
      doc.text(`Justification: ${req.justification}`);
      doc.text(`Assigned To: ${req.assigned_user_name || 'Not Assigned'}`);
      doc.text(`Created At: ${new Date(req.created_at).toLocaleString()}`);
      doc.moveDown();
    });

    doc.end();
  } catch (err) {
    console.error('❌ PDF export failed:', err);
    res.status(500).json({ error: 'PDF export failed' });
  }
});

// ==========================
// 🔍 Request Details & Logs
// ==========================
router.get('/:id/items', getRequestItemsOnly);
router.get('/:id/logs', getRequestLogs);
router.get('/:id/rfx', generateRfx);
router.get('/:id/print', printRequest);
router.get('/:id', getRequestDetails);

// ==========================
// ✅ Approval & Assignment
// ==========================
router.put('/approval/:id', updateApprovalStatus);
router.put('/assign', assignRequestToProcurement);
router.put('/assign-procurement', assignRequestToUser);

module.exports = router;
