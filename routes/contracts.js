const express = require('express');
const upload = require('../middleware/upload');
const {
  listContracts,
  getContractById,
  createContract,
  updateContract,
  archiveContract,
  getContractAttachments,
  uploadContractAttachment,
  getEvaluationCandidates,
} = require('../controllers/contractsController');

const router = express.Router();

router.get('/', listContracts);
router.get('/:contractId/evaluation-candidates', getEvaluationCandidates);
router.get('/:id', getContractById);
router.post('/', createContract);
router.patch('/:id', updateContract);
router.patch('/:id/archive', archiveContract);

router.get('/:contractId/attachments', getContractAttachments);
router.post('/:contractId/attachments', upload.single('file'), uploadContractAttachment);

module.exports = router;