const express = require('express');
const {
  listItems,
  getItemById,
  createItem,
  updateItem,
  submitForApproval,
  approveItem,
  rejectItem,
  addDocument,
} = require('../controllers/itemMasterController');

const router = express.Router();

router.get('/', listItems);
router.get('/:id', getItemById);
router.post('/', createItem);
router.put('/:id', updateItem);
router.post('/:id/submit', submitForApproval);
router.post('/:id/approve', approveItem);
router.post('/:id/reject', rejectItem);
router.post('/:id/documents', addDocument);

module.exports = router;