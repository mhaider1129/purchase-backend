const express = require('express');
const router = express.Router();
const { getStockItems } = require('../controllers/stockItemsController');

router.get('/', getStockItems);

module.exports = router;