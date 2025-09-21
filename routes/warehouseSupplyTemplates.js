const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const {
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} = require('../controllers/warehouseSupplyTemplatesController');

router.use(authenticateUser);

router.get('/', getTemplates);
router.post('/', createTemplate);
router.put('/:id', updateTemplate);
router.delete('/:id', deleteTemplate);

module.exports = router;