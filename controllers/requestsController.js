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
  getHodApprovers,
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
  requestHodApproval,
  markRequestAsCompleted,
  markRequestAsReceived,
  updateRequestCost,
  approveMaintenanceRequest,
  reassignMaintenanceRequestToRequester,
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
  getHodApprovers,
  assignRequestToProcurement,
  updateApprovalStatus,
  requestHodApproval,
  getApprovalHistory,
  assignApprover,
  getProcurementUsers,
  getAssignedRequests,
  getMyMaintenanceRequests,
  getPendingMaintenanceApprovals,
  approveMaintenanceRequest,
  reassignMaintenanceRequestToRequester,
  getRequestLogs,
  markRequestAsCompleted,
  markRequestAsReceived,
  updateRequestCost,
  getAuditApprovedRejectedRequests,
  getClosedRequests,
  generateRfx,
  printRequest,
};