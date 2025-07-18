const express = require('express');
const router = express.Router();

// ✅ Middleware
const { authenticateUser } = require('../middleware/authMiddleware');

// ✅ Controllers
const {
  addRequestedItems,
  updateItemCost,
  updateItemProcurementStatus,
  updateItemPurchasedQuantity
} = require('../controllers/requestedItemsController');

/**
 * @route   POST /api/requested-items
 * @desc    Add one or more items to an existing request
 * @access  Private (Authenticated users)
 */
router.post('/', authenticateUser, addRequestedItems);

/**
 * @route   PUT /api/requested-items/:id/cost
 * @desc    Update unit cost of a specific item (SCM or assigned Procurement user only)
 * @access  Private (Authenticated + Authorized users)
 */
router.put('/:id/cost', authenticateUser, updateItemCost);

/**
 * @route   PUT /api/requested-items/:item_id/procurement-status
 * @desc    Update procurement status of a requested item
 * @access  Private (SCM or ProcurementSupervisor/Specialist only)
 */
router.put('/:item_id/procurement-status', authenticateUser, updateItemProcurementStatus);

/**
 * @route   PUT /api/requested-items/:item_id/purchased-quantity
 * @desc    Update purchased quantity of a requested item
 * @access  Private (SCM or ProcurementSupervisor/Specialist only)
 */
router.put('/:item_id/purchased-quantity', authenticateUser, updateItemPurchasedQuantity);

module.exports = router;
