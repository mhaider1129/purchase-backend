const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');
const { createNotifications } = require('../../utils/notificationService');

const normalizeText = value => (typeof value === 'string' ? value.trim() : '');
const allowedRoles = new Set(['HOD', 'SCM', 'PROCUREMENTSPECIALIST', 'ADMIN']);

const recordDirectPurchaseCommunication = async (req, res, next) => {
  const requestId = Number(req.params.id);
  const parsedActorId = Number(req.user?.id);
  const actorId = Number.isInteger(parsedActorId) ? parsedActorId : null;
  const actorRole = normalizeText(req.user?.role || '').toUpperCase();
  const parsedActorDepartmentId = Number(req.user?.department_id);
  const actorDepartmentId = Number.isInteger(parsedActorDepartmentId)
    ? parsedActorDepartmentId
    : null;

  const message = normalizeText(req.body?.message || req.body?.note);
  const urgencyDetails = normalizeText(
    req.body?.urgency_reason || req.body?.urgencyReason || req.body?.urgency_note
  );

  if (!Number.isInteger(requestId)) {
    return next(createHttpError(400, 'Invalid request ID'));
  }

  if (!message) {
    return next(
      createHttpError(
        400,
        'A description of the direct purchase or urgency is required to document it.'
      )
    );
  }

  if (!actorId) {
    return next(createHttpError(403, 'Unable to identify the current user.'));
  }

  if (!allowedRoles.has(actorRole)) {
    return next(
      createHttpError(
        403,
        'You are not permitted to record direct purchase communications.'
      )
    );
  }

  const client = await pool.connect();
  let transactionActive = false;

  try {
    await client.query('BEGIN');
    transactionActive = true;

    const requestRes = await client.query(
      `SELECT id, department_id, requester_id, assigned_to, request_type
         FROM requests
        WHERE id = $1
        FOR UPDATE`,
      [requestId],
    );

    if (requestRes.rowCount === 0) {
      await client.query('ROLLBACK');
      transactionActive = false;
      return next(createHttpError(404, 'Request not found'));
    }

    const request = requestRes.rows[0];
    const requestDepartmentId = Number(request.department_id);

    if (
      actorRole === 'HOD' &&
      (!Number.isInteger(requestDepartmentId) || actorDepartmentId !== requestDepartmentId)
    ) {
      await client.query('ROLLBACK');
      transactionActive = false;
      return next(
        createHttpError(
          403,
          'HODs can only document direct purchases for their own department.'
        )
      );
    }

    const comments = urgencyDetails ? `${message} | Urgency: ${urgencyDetails}` : message;

    const logRes = await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, 'Direct Purchase Communication', $2, $3)
       RETURNING id, request_id, action, actor_id, comments, timestamp`,
      [requestId, actorId, comments],
    );

    const recipientIds = new Set();
    const addRecipient = value => {
      const parsed = Number(value);
      if (Number.isInteger(parsed)) {
        recipientIds.add(parsed);
      }
    };

    addRecipient(request.requester_id);

    const hodRes = await client.query(
      `SELECT id
         FROM users
        WHERE department_id = $1
          AND LOWER(role) = 'hod'
          AND is_active = TRUE`,
      [request.department_id],
    );
    hodRes.rows.forEach(row => addRecipient(row.id));

    addRecipient(request.assigned_to);

    const scmRes = await client.query(
      `SELECT id
         FROM users
        WHERE UPPER(role) = 'SCM'
          AND is_active = TRUE`,
    );
    scmRes.rows.forEach(row => addRecipient(row.id));

    const actorName = normalizeText(req.user?.name) || actorRole || 'User';
    const shortType = normalizeText(request.request_type) || 'purchase';
    const baseNotificationMessage = `${actorName} documented a direct ${shortType} purchase due to urgency for Request #${requestId}.`;
    const notificationBody = urgencyDetails
      ? `${baseNotificationMessage} Urgency: ${urgencyDetails}`
      : baseNotificationMessage;

    const notifications = Array.from(recipientIds)
      .filter(userId => Number.isInteger(userId) && userId !== actorId)
      .map(userId => ({
        userId,
        title: `Direct purchase documented for Request #${requestId}`,
        message: notificationBody,
        link: `/requests/${requestId}`,
        metadata: {
          requestId,
          type: 'direct_purchase',
          recordedByRole: actorRole || null,
          urgencyDetails: urgencyDetails || null,
        },
      }));

    if (notifications.length > 0) {
      await createNotifications(notifications, client);
    }

    await client.query('COMMIT');
    transactionActive = false;

    return res.status(201).json({
      message:
        'Direct purchase communication recorded and shared with the requesting department and supply chain.',
      log: logRes.rows[0],
      recipients_notified: notifications.length,
    });
  } catch (err) {
    if (transactionActive) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('⚠️ Failed to rollback direct purchase communication transaction:', rollbackErr);
      }
    }
    console.error('❌ Failed to record direct purchase communication:', err);
    return next(createHttpError(500, 'Failed to record direct purchase communication'));
  } finally {
    client.release();
  }
};

module.exports = {
  recordDirectPurchaseCommunication,
};