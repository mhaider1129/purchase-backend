const express = require('express');
const router = express.Router();
const {
  listResources,
  updateResource,
} = require('../controllers/uiAccessController');

router.get('/', listResources);
router.put('/:resourceKey', updateResource);

module.exports = router;