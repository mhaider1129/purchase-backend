const pool = require('../config/db');
const { sendEmail } = require('./emailService');

const normalizeRecipients = (recipients) => {
  const values = Array.isArray(recipients) ? recipients : [recipients];
  return [...new Set(values.map((value) => (value == null ? '' : String(value).trim())).filter(Boolean))];
};

const fetchRequestEmailRecipients = async (requestId, { client = pool, includeScm = true } = {}) => {
  if (!requestId) return [];

  const { rows } = await client.query(
    `SELECT u.email
       FROM requests r
       JOIN users u ON u.id IN (r.requester_id, r.assigned_to)
      WHERE r.id = $1
        AND u.email IS NOT NULL
     UNION
     SELECT u.email
       FROM users u
      WHERE $2 = TRUE
        AND u.role IN ('SCM', 'ProcurementSpecialist')
        AND u.is_active = TRUE
        AND u.email IS NOT NULL`,
    [requestId, includeScm]
  );

  return normalizeRecipients(rows.map((row) => row.email));
};

const sendWorkflowEmail = async ({ to, subject, message, options = {}, logLabel = 'workflow notification' }) => {
  const recipients = normalizeRecipients(to);
  if (recipients.length === 0) return null;

  try {
    return await sendEmail(recipients, subject, message, options);
  } catch (error) {
    console.error(`⚠️ Failed to send ${logLabel}:`, error);
    return null;
  }
};

const sendRequestWorkflowEmail = async ({ requestId, subject, message, options = {}, logLabel, client = pool, includeScm = true }) => {
  try {
    const recipients = await fetchRequestEmailRecipients(requestId, { client, includeScm });
    return await sendWorkflowEmail({ to: recipients, subject, message, options, logLabel });
  } catch (error) {
    console.error(`⚠️ Failed to prepare ${logLabel || 'workflow notification'}:`, error);
    return null;
  }
};

module.exports = {
  fetchRequestEmailRecipients,
  sendWorkflowEmail,
  sendRequestWorkflowEmail,
  _private: {
    normalizeRecipients,
  },
};