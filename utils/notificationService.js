const pool = require('../config/db');

let ensurePromise = null;

const ensureNotificationsTable = async () => {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT,
          message TEXT NOT NULL,
          link TEXT,
          metadata JSONB,
          is_read BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await pool.query(
        `CREATE INDEX IF NOT EXISTS notifications_user_read_created_idx
         ON notifications(user_id, is_read, created_at DESC)`
      );
    })().catch(err => {
      ensurePromise = null;
      throw err;
    });
  }

  return ensurePromise;
};

const normalizeText = value => {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeMetadata = metadata => {
  if (metadata == null) {
    return null;
  }

  if (typeof metadata === 'string') {
    const trimmed = metadata.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      return trimmed;
    }
  }

  if (Buffer.isBuffer(metadata)) {
    return null;
  }

  if (typeof metadata === 'object') {
    return metadata;
  }

  return null;
};

const normalizeNotifications = notifications => {
  if (!Array.isArray(notifications)) {
    return [];
  }

  return notifications
    .map(notification => {
      if (!notification) return null;

      const userId = notification.userId ?? notification.user_id;
      if (userId == null) return null;

      const parsedUserId = Number(userId);
      if (!Number.isInteger(parsedUserId)) return null;

      const message = normalizeText(notification.message);
      if (!message) return null;

      const title = normalizeText(notification.title);
      const link = normalizeText(notification.link);
      const metadata = normalizeMetadata(notification.metadata);

      return {
        userId: parsedUserId,
        title,
        message,
        link,
        metadata,
      };
    })
    .filter(Boolean);
};

const createNotifications = async (notifications, client = null) => {
  const entries = normalizeNotifications(notifications);
  if (entries.length === 0) {
    return [];
  }

  await ensureNotificationsTable();

  const queryable = client || pool;
  const values = [];
  const placeholders = entries.map((entry, idx) => {
    const base = idx * 5;
    values.push(entry.userId);
    values.push(entry.title);
    values.push(entry.message);
    values.push(entry.link);
    values.push(entry.metadata ? JSON.stringify(entry.metadata) : null);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb)`;
  });

  const query = `
    INSERT INTO notifications (user_id, title, message, link, metadata)
    VALUES ${placeholders.join(', ')}
    RETURNING *
  `;

  const { rows } = await queryable.query(query, values);
  return rows;
};

const createNotification = async (notification, client = null) => {
  const [row] = await createNotifications([notification], client);
  return row || null;
};

const mapNotificationRow = row => {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    message: row.message,
    link: row.link,
    metadata: row.metadata,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
};

const getUserNotifications = async (userId, options = {}, client = null) => {
  const parsedUserId = Number(userId);
  if (!Number.isInteger(parsedUserId)) {
    throw new TypeError('userId must be a valid integer');
  }

  await ensureNotificationsTable();

  const {
    includeRead = false,
    limit: requestedLimit = 50,
    offset: requestedOffset = 0,
    unreadOnly,
  } = options || {};

  let limit = Number(requestedLimit);
  if (!Number.isInteger(limit) || limit <= 0) {
    limit = 50;
  }
  limit = Math.min(Math.max(limit, 1), 100);

  let offset = Number(requestedOffset);
  if (!Number.isInteger(offset) || offset < 0) {
    offset = 0;
  }

  const showUnreadOnly = unreadOnly === undefined ? !includeRead : Boolean(unreadOnly);

  const queryable = client || pool;
  const values = [parsedUserId];
  const conditions = ['user_id = $1'];

  if (showUnreadOnly) {
    conditions.push('is_read = false');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const notificationsQuery = `
    SELECT id, user_id, title, message, link, metadata, is_read, created_at
      FROM notifications
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
  `;

  values.push(limit, offset);

  const [notificationsResult, unreadCountResult] = await Promise.all([
    queryable.query(notificationsQuery, values),
    queryable.query(
      `SELECT COUNT(*)::int AS unread_count FROM notifications WHERE user_id = $1 AND is_read = false`,
      [parsedUserId],
    ),
  ]);

  const rows = Array.isArray(notificationsResult.rows) ? notificationsResult.rows : [];
  const unreadCountRow = unreadCountResult.rows?.[0];

  return {
    notifications: rows.map(mapNotificationRow).filter(Boolean),
    unreadCount: unreadCountRow ? Number(unreadCountRow.unread_count) || 0 : 0,
  };
};

const markNotificationRead = async (notificationId, userId, client = null) => {
  const parsedId = Number(notificationId);
  const parsedUserId = Number(userId);

  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    throw new TypeError('notificationId must be a positive integer');
  }

  if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
    throw new TypeError('userId must be a positive integer');
  }

  await ensureNotificationsTable();

  const queryable = client || pool;
  const { rows } = await queryable.query(
    `
      UPDATE notifications
         SET is_read = true
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, title, message, link, metadata, is_read, created_at
    `,
    [parsedId, parsedUserId],
  );

  return mapNotificationRow(rows?.[0] || null);
};

const markAllNotificationsRead = async (userId, client = null) => {
  const parsedUserId = Number(userId);

  if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
    throw new TypeError('userId must be a positive integer');
  }

  await ensureNotificationsTable();

  const queryable = client || pool;
  const result = await queryable.query(
    `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
    [parsedUserId],
  );

  return result.rowCount || 0;
};

module.exports = {
  createNotification,
  createNotifications,
  getUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  _private: {
    ensureNotificationsTable,
    normalizeNotifications,
  },
};