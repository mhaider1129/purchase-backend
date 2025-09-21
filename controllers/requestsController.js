// controllers/requestsController.js
const {
  createRequest,
  assignApprover,
} = require('./requests/createRequestController');

const {
  getRequestDetails,
  getRequestItemsOnly,
  getMyRequests,
  getAllRequests,
  getPendingApprovals,
  getAssignedRequests,
  getApprovalHistory,
  getProcurementUsers,
  getMyMaintenanceRequests,
  getPendingMaintenanceApprovals,
  getAuditApprovedRejectedRequests,
  getClosedRequests,
  getRequestLogs,
} = require('./requests/fetchRequestsController');

const {
  assignRequestToProcurement,
  updateApprovalStatus,
  markRequestAsCompleted,
  updateRequestCost,
  approveMaintenanceRequest,
} = require('./requests/updateRequestsController');

const { generateRfx } = require('./requests/generateRfxController');
const { printRequest } = require('./requests/printRequestController');

module.exports = {
  createRequest,
  getRequestDetails,
  getRequestItemsOnly,
  getMyRequests,
  getAllRequests,
  getPendingApprovals,
  assignRequestToProcurement,
  updateApprovalStatus,
  getApprovalHistory,
  assignApprover,
  getProcurementUsers,
  getAssignedRequests,
  getMyMaintenanceRequests,
  getPendingMaintenanceApprovals,
  approveMaintenanceRequest,
  getRequestLogs,
  markRequestAsCompleted,
  updateRequestCost,
  getAuditApprovedRejectedRequests,
  getClosedRequests,
  generateRfx,
  printRequest,
};