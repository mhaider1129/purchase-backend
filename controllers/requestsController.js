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
  getClosedRequests,
  generateRfx,
};