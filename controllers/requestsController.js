// controllers/requestsController.js
const {
  createRequest,
  assignApprover,
} = require('./requests/createRequestController');

const { insertHistoricalRequest } = require('./requests/historicalRequestController');

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
  updateRequestBeforeApproval,
  approveMaintenanceRequest,
  reassignMaintenanceRequestToRequester,
} = require('./requests/updateRequestsController');

const {
  sendStatusCommunication,
  listStatusCommunications,
} = require('./requests/statusCommunicationController');

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
  updateRequestBeforeApproval,
  getAuditApprovedRejectedRequests,
  getClosedRequests,
  generateRfx,
  printRequest,
  insertHistoricalRequest,
  sendStatusCommunication,
  listStatusCommunications,
};