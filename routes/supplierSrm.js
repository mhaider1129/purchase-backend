const express = require('express');
const {
  listSupplierScorecards,
  createSupplierScorecard,
  listSupplierIssues,
  createSupplierIssue,
  updateSupplierIssue,
  listComplianceArtifacts,
  createComplianceArtifact,
  getSupplierSrmStatus,
} = require('../controllers/supplierSrmController');

const router = express.Router();

router.get('/:supplierId/status', getSupplierSrmStatus);
router.get('/:supplierId/scorecards', listSupplierScorecards);
router.post('/:supplierId/scorecards', createSupplierScorecard);
router.get('/:supplierId/issues', listSupplierIssues);
router.post('/:supplierId/issues', createSupplierIssue);
router.patch('/issues/:issueId', updateSupplierIssue);
router.get('/:supplierId/compliance', listComplianceArtifacts);
router.post('/:supplierId/compliance', createComplianceArtifact);

module.exports = router;