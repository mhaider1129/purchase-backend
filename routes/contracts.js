const express = require('express');
const upload = require('../middleware/upload');
const { authenticateUser } = require('../middleware/authMiddleware');
const {
  listContracts,
  getContractById,
  createContract,
  updateContract,
  archiveContract,
  unarchiveContract,
  renewContract,
  deleteContract,
  getContractAttachments,
  uploadContractAttachment,
  deleteContractAttachment,
  getEvaluationCandidates,
  listContractAmendments,
  createContractAmendment,
  submitContractReview,
  listPendingContractApprovals,
  listContractApprovals,
  listContractApprovalStageMonitor,
  decideContractApproval,
  listContractItems,
  createContractItem,
  updateContractItem,
  deleteContractItem,
  getDocumentChecklist,
  updateDocumentChecklist,
  getContractConsumption,
  getContractRisk,
  getContractRiskHistory,
  recalculateContractRisk,
  getContractRiskDashboard,
  listHighRiskContracts,
  requestContractAiExtraction,
  listContractAiExtractions,
  getContractAiExtractionById,
  listContractDocuments,
  createContractDocument,
  getContractDocument,
  updateContractDocument,
  addContractDocumentVersion,
  markContractDocumentVersionCurrent,
  archiveContractDocument,
  deleteContractDocument,
  listContractObligations,
  createContractObligation,
  getContractObligation,
  patchContractObligation,
  completeContractObligation,
  waiveContractObligation,
  cancelContractObligation,
  listDueSoonContractObligations,
  listContractRenewalEvents,
  createContractRenewalEvent,
  updateContractRenewalEvent,
  decideContractRenewalEvent,
  listDueSoonContractRenewals,
  listContractInvoices,
  createContractInvoice,
  getContractInvoice,
  updateContractInvoice,
  matchContractInvoice,
  updateContractInvoiceStatus,
  listContractPayments,
  createContractPayment,
  updateContractPayment,
  updateContractPaymentStatus,
  listContractConsumptionEntries,
  createContractConsumptionEntry,
  getContractFinancialSummary,
} = require('../controllers/contractsController');
const { getContractHealth, updateContractGovernanceFields } = require('../controllers/contractGovernanceController');

const router = express.Router();

router.get('/', listContracts);
router.get('/:contractId/evaluation-candidates', getEvaluationCandidates);
router.get('/pending-approvals', authenticateUser, listPendingContractApprovals);
router.get('/approval-stage-monitor', authenticateUser, listContractApprovalStageMonitor);
router.get('/:id', getContractById);
router.post('/', createContract);
router.patch('/:id', updateContract);
router.patch('/:id/archive', archiveContract);
router.patch('/:id/unarchive', unarchiveContract);
router.post('/:id/renew', renewContract);
router.post('/:id/submit-review', authenticateUser, submitContractReview);
router.get('/:id/approvals', authenticateUser, listContractApprovals);
router.post('/:id/approvals/:approvalId/decision', authenticateUser, decideContractApproval);
router.get('/:id/items', listContractItems);
router.post('/:id/items', createContractItem);
router.patch('/:id/items/:itemId', updateContractItem);
router.delete('/:id/items/:itemId', deleteContractItem);
router.get('/:id/document-checklist', getDocumentChecklist);
router.patch('/:id/document-checklist/:documentId', updateDocumentChecklist);
router.get('/:id/consumption', getContractConsumption);
router.get('/dashboard/risk', getContractRiskDashboard);
router.get('/risk/high', listHighRiskContracts);
router.get('/obligations/due-soon', listDueSoonContractObligations);
router.get('/renewals/due-soon', listDueSoonContractRenewals);
router.get('/:id/risk', getContractRisk);
router.post('/:id/risk/recalculate', recalculateContractRisk);
router.get('/:id/risk/history', getContractRiskHistory);
router.post('/:id/ai-extract', requestContractAiExtraction);
router.get('/:id/ai-extractions', listContractAiExtractions);
router.get('/:id/ai-extractions/:extractionId', getContractAiExtractionById);
router.get('/:id/documents', listContractDocuments);
router.post('/:id/documents', createContractDocument);
router.get('/:id/documents/:documentId', getContractDocument);
router.patch('/:id/documents/:documentId', updateContractDocument);
router.post('/:id/documents/:documentId/versions', addContractDocumentVersion);
router.patch('/:id/documents/:documentId/versions/:versionId/current', markContractDocumentVersionCurrent);
router.patch('/:id/documents/:documentId/archive', archiveContractDocument);
router.delete('/:id/documents/:documentId', deleteContractDocument);
router.get('/:id/health', getContractHealth);
router.patch('/:id/governance', updateContractGovernanceFields);
router.get('/:id/obligations', listContractObligations);
router.post('/:id/obligations', createContractObligation);
router.get('/:id/obligations/:obligationId', getContractObligation);
router.patch('/:id/obligations/:obligationId', patchContractObligation);
router.patch('/:id/obligations/:obligationId/complete', completeContractObligation);
router.patch('/:id/obligations/:obligationId/waive', waiveContractObligation);
router.patch('/:id/obligations/:obligationId/cancel', cancelContractObligation);
router.get('/:id/renewal-events', listContractRenewalEvents);
router.post('/:id/renewal-events', createContractRenewalEvent);
router.patch('/:id/renewal-events/:renewalEventId', updateContractRenewalEvent);
router.patch('/:id/renewal-events/:renewalEventId/decision', decideContractRenewalEvent);
router.get('/:id/payments', listContractPayments);
router.post('/:id/payments', createContractPayment);
router.patch('/:id/payments/:paymentId', updateContractPayment);
router.patch('/:id/payments/:paymentId/status', updateContractPaymentStatus);
router.get('/:id/invoices', listContractInvoices);
router.post('/:id/invoices', createContractInvoice);
router.get('/:id/invoices/:invoiceId', getContractInvoice);
router.patch('/:id/invoices/:invoiceId', updateContractInvoice);
router.patch('/:id/invoices/:invoiceId/match', matchContractInvoice);
router.patch('/:id/invoices/:invoiceId/status', updateContractInvoiceStatus);
router.get('/:id/financial-summary', getContractFinancialSummary);
router.get('/:id/consumption-entries', listContractConsumptionEntries);
router.post('/:id/consumption-entries', createContractConsumptionEntry);
router.get('/:id/amendments', listContractAmendments);
router.post('/:id/amendments', createContractAmendment);
router.delete('/:id', deleteContract);

router.get('/:contractId/attachments', getContractAttachments);
router.post('/:contractId/attachments', authenticateUser, upload.any(), uploadContractAttachment);
router.delete('/:contractId/attachments/:attachmentId', deleteContractAttachment);

module.exports = router;