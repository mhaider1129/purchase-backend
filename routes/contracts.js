const express = require('express');
const {
  listContracts,
  getContractById,
  createContract,
  updateContract,
  archiveContract,
} = require('../controllers/contractsController');

const router = express.Router();

router.get('/', listContracts);
router.get('/:id', getContractById);
router.post('/', createContract);
router.patch('/:id', updateContract);
router.patch('/:id/archive', archiveContract);

module.exports = router;