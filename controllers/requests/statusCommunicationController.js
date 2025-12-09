const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');
const { createNotifications } = require('../../utils/notificationService');

const normalizeRole = (role) => (typeof role === 'string' ? role.trim().toUpperCase() : '');

const allowedCommunicators = new Set(['HOD', 'CMO', 'COO']);

const fetchScmRecipients = async (assignedToId) => {
  if (assignedToId) {
    return [assignedToId];
  }

  const { rows } = await pool.query(
    `SELECT id FROM users WHERE UPPER(role) = 'SCM' AND is_active = TRUE`
  );

  return rows.map((row) => row.id);
};

const sendStatusCommunication = async (req, res, next) => {
  const requestId = req.params.id;
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const actorId = req.user?.id;
  const actorRole = normalizeRole(req.user?.role);

  if (!/^\d+$/.test(String(requestId || ''))) {
    return next(createHttpError(400, 'Invalid request ID'));
  }

  if (!allowedCommunicators.has(actorRole)) {
    return next(createHttpError(403, 'Only HOD, CMO, or COO users can send status communications.'));
  }

  if (!message) {
    return next(createHttpError(400, 'Message is required.'));
  }

  try {
    const requestRes = await pool.query(
      `SELECT id, status, assigned_to
         FROM requests
        WHERE id = $1`,
      [requestId]
    );

    if (requestRes.rowCount === 0) {
      return next(createHttpError(404, 'Request not found'));
    }

    const request = requestRes.rows[0];
    const statusLabel = (request.status || 'Pending').trim() || 'Pending';

    const logRes = await pool.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, $2, $3, $4)
       RETURNING id, request_id, actor_id, comments, timestamp`,
      [requestId, `Status Communication (${statusLabel})`, actorId, message]
    );

    const communication = {
      ...logRes.rows[0],
      actor_name: req.user?.name || 'Unknown',
      status_at_time: statusLabel,
    };

    const recipients = await fetchScmRecipients(request.assigned_to);

    if (recipients.length > 0) {
      await createNotifications(
        recipients.map((userId) => ({
          userId,
          title: `Request #${requestId} status update`,
          message: `${actorRole} ${req.user?.name || ''} shared an update for Request #${requestId} (${statusLabel}).`,
          link: `/requests/${requestId}`,
          metadata: { requestId: Number(requestId), type: 'status_communication', status: statusLabel },
        }))
      );
    }

    res.status(201).json({
      message: recipients.length > 0
        ? 'Communication sent to SCM users.'
        : 'Communication recorded. No SCM recipients found.',
      communication,
      recipients_notified: recipients.length,
    });
  } catch (err) {
    console.error('❌ Failed to send status communication:', err);
    next(createHttpError(500, 'Failed to send status communication'));
  }
};

const listStatusCommunications = async (req, res, next) => {
  const requestId = req.params.id;

  if (!/^\d+$/.test(String(requestId || ''))) {
    return next(createHttpError(400, 'Invalid request ID'));
  }

  try {
    const { rows } = await pool.query(
      `SELECT
         rl.id,
         rl.request_id,
         rl.actor_id,
         rl.comments,
         rl.timestamp,
         rl.action,
         u.name AS actor_name,
         NULLIF(regexp_replace(rl.action, '^Status Communication \((.+)\)$', '\\1'), '') AS status_at_time
       FROM request_logs rl
       LEFT JOIN users u ON rl.actor_id = u.id
       WHERE rl.request_id = $1
         AND rl.action ILIKE 'Status Communication (%'
       ORDER BY rl.timestamp DESC, rl.id DESC`,
      [requestId]
    );

    const formatted = rows.map((row) => ({
      ...row,
      status_at_time: row.status_at_time || 'Pending',
    }));

    res.json(formatted);
  } catch (err) {
    console.error('❌ Failed to load status communications:', err);
    next(createHttpError(500, 'Failed to load status communications'));
  }
};

module.exports = {
  sendStatusCommunication,
  listStatusCommunications,
};