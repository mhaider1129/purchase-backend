const createHttpError = require('../utils/httpError');
const { LIFECYCLE_STATES, canTransitionState } = require('./procureToPayService');

const ensureLifecycleRow = async (client, requestId, userId) => {
  await client.query(
    `INSERT INTO procurement_lifecycle_states (request_id, procurement_state, created_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (request_id) DO NOTHING`,
    [requestId, LIFECYCLE_STATES.DRAFT_PR, userId || null]
  );
};

const transitionLifecycleState = async (
  client,
  requestId,
  toState,
  userId,
  reason = null,
  metadata = null
) => {
  const { rows } = await client.query(
    `SELECT procurement_state FROM procurement_lifecycle_states WHERE request_id = $1`,
    [requestId]
  );

  const fromState = rows[0]?.procurement_state || null;

  if (fromState === toState) {
    return;
  }

  if (!canTransitionState(fromState, toState)) {
    throw createHttpError(400, `Invalid lifecycle transition from ${fromState || 'N/A'} to ${toState}`);
  }

  await client.query(
    `UPDATE procurement_lifecycle_states
     SET procurement_state = $2, last_transition_at = NOW(), updated_at = NOW()
     WHERE request_id = $1`,
    [requestId, toState]
  );

  await client.query(
    `INSERT INTO procurement_state_history (request_id, from_state, to_state, changed_by, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [requestId, fromState, toState, userId || null, reason, metadata ? JSON.stringify(metadata) : null]
  );
};

module.exports = {
  ensureLifecycleRow,
  transitionLifecycleState,
};