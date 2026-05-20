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
router.get('/:id/amendments', listContractAmendments);
router.post('/:id/amendments', createContractAmendment);
router.delete('/:id', deleteContract);

router.get('/:contractId/attachments', getContractAttachments);
router.post('/:contractId/attachments', authenticateUser, upload.any(), uploadContractAttachment);
router.delete('/:contractId/attachments/:attachmentId', deleteContractAttachment);

module.exports = router;