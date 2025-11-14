const createHttpError = require('../utils/httpError');
const {
  getUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require('../utils/notificationService');

const parseBoolean = (value, defaultValue = false) => {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
};

const parseNumber = (value, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) => {
  const parsed = Number(value);
  if (Number.isInteger(parsed)) {
    return Math.min(Math.max(parsed, min), max);
  }
  return fallback;
};

const listNotifications = async (req, res, next) => {
  const userId = req.user?.id;

  if (!Number.isInteger(userId)) {
    return next(createHttpError(401, 'User context not found'));
  }

  try {
    const limit = parseNumber(req.query.limit, { min: 1, max: 100, fallback: 50 });
    const offset = parseNumber(req.query.offset, { min: 0, fallback: 0 });
    const includeRead = parseBoolean(req.query.includeRead, false);
    const unreadOnly = parseBoolean(req.query.unread ?? req.query.unreadOnly, !includeRead);

    const { notifications, unreadCount } = await getUserNotifications(userId, {
      limit,
      offset,
      includeRead,
      unreadOnly,
    });

    res.json({
      success: true,
      data: notifications,
      meta: {
        count: notifications.length,
        unreadCount,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error('❌ Failed to fetch notifications:', error);
    next(createHttpError(500, 'Failed to fetch notifications'));
  }
};

const markAsRead = async (req, res, next) => {
  const userId = req.user?.id;
  const notificationId = parseNumber(req.params.id, { min: 1, fallback: null });

  if (!Number.isInteger(userId)) {
    return next(createHttpError(401, 'User context not found'));
  }

  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    return next(createHttpError(400, 'Invalid notification ID'));
  }

  try {
    const updated = await markNotificationRead(notificationId, userId);
    if (!updated) {
      return next(createHttpError(404, 'Notification not found'));
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('❌ Failed to mark notification as read:', error);
    next(createHttpError(500, 'Failed to mark notification as read'));
  }
};

const markAllAsRead = async (req, res, next) => {
  const userId = req.user?.id;

  if (!Number.isInteger(userId)) {
    return next(createHttpError(401, 'User context not found'));
  }

  try {
    const affected = await markAllNotificationsRead(userId);
    res.json({ success: true, data: { updated: affected } });
  } catch (error) {
    console.error('❌ Failed to mark all notifications as read:', error);
    next(createHttpError(500, 'Failed to mark notifications as read'));
  }
};

module.exports = {
  listNotifications,
  markAsRead,
  markAllAsRead,
};