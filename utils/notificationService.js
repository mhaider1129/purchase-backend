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

module.exports = {
  createNotification,
  createNotifications,
  _private: {
    ensureNotificationsTable,
    normalizeNotifications,
  },
};
