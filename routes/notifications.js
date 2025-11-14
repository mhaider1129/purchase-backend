const express = require('express');
const {
  listNotifications,
  markAsRead,
  markAllAsRead,
} = require('../controllers/notificationsController');

const router = express.Router();

router.get('/', listNotifications);
router.patch('/read-all', markAllAsRead);
router.patch('/:id/read', markAsRead);

module.exports = router;