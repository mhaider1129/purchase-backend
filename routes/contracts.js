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
  listContractApprovals,
  decideContractApproval,
  listContractItems,
  createContractItem,
  updateContractItem,
  deleteContractItem,
  getDocumentChecklist,
  updateDocumentChecklist,
  getContractConsumption,
  getContractRisk,
} = require('../controllers/contractsController');

const router = express.Router();

router.get('/', listContracts);
router.get('/:contractId/evaluation-candidates', getEvaluationCandidates);
router.get('/:id', getContractById);
router.post('/', createContract);
router.patch('/:id', updateContract);
router.patch('/:id/archive', archiveContract);
router.patch('/:id/unarchive', unarchiveContract);
router.post('/:id/renew', renewContract);
router.post('/:id/submit-review', submitContractReview);
router.get('/:id/approvals', listContractApprovals);
router.post('/:id/approvals/:approvalId/decision', decideContractApproval);
router.get('/:id/items', listContractItems);
router.post('/:id/items', createContractItem);
router.patch('/:id/items/:itemId', updateContractItem);
router.delete('/:id/items/:itemId', deleteContractItem);
router.get('/:id/document-checklist', getDocumentChecklist);
router.patch('/:id/document-checklist/:documentId', updateDocumentChecklist);
router.get('/:id/consumption', getContractConsumption);
router.get('/:id/risk', getContractRisk);
router.get('/:id/amendments', listContractAmendments);
router.post('/:id/amendments', createContractAmendment);
router.delete('/:id', deleteContract);

router.get('/:contractId/attachments', getContractAttachments);
router.post('/:contractId/attachments', authenticateUser, upload.any(), uploadContractAttachment);
router.delete('/:contractId/attachments/:attachmentId', deleteContractAttachment);

module.exports = router;