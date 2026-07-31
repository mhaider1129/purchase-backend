const { ENTITY_TYPES, REQUEST_STATUS: R, normalizeStatus } = require('./statusConstants');

class StatusTransitionError extends Error {
  constructor(message, code, details = null) { super(message); this.name = 'StatusTransitionError'; this.code = code; this.details = details; }
}

class StatusTransitionService {
  constructor() { this.registry = new Map(); }
  register(entityType, { transitions, terminalStates = [] }) {
    if (!entityType || !transitions || typeof transitions !== 'object') throw new TypeError('entityType and transitions are required');
    this.registry.set(entityType, {
      transitions: new Map(Object.entries(transitions).map(([state, next]) => [normalizeStatus(state), new Set(next.map(normalizeStatus))])),
      terminalStates: new Set(terminalStates.map(normalizeStatus)),
    });
    return this;
  }
  validate({ entityType, currentState, nextState, actor = null, reason = null, allowIdempotent = false }) {
    const from = normalizeStatus(currentState); const to = normalizeStatus(nextState);
    const definition = this.registry.get(entityType);
    if (!definition) throw new StatusTransitionError(`Unregistered entity type: ${entityType}`, 'UNKNOWN_ENTITY_TYPE');
    if (allowIdempotent && from === to) return Object.freeze({ entityType, from, to, actor, reason, terminal: definition.terminalStates.has(to), idempotent: true });
    if (!definition.transitions.has(from) && !definition.terminalStates.has(from)) throw new StatusTransitionError(`Unknown current state: ${from}`, 'UNKNOWN_CURRENT_STATE');
    if (definition.terminalStates.has(from)) throw new StatusTransitionError(`State is terminal: ${from}`, 'TERMINAL_STATE');
    if (!definition.transitions.get(from)?.has(to)) throw new StatusTransitionError(`Invalid transition from ${from} to ${to}`, 'INVALID_TRANSITION', { from, to });
    return Object.freeze({ entityType, from, to, actor, reason, terminal: definition.terminalStates.has(to) });
  }
}

const requestStatusTransitions = Object.freeze({
  [R.DRAFT]: [R.SUBMITTED, R.CANCELLED],
  [R.SUBMITTED]: [R.PENDING, R.RETURNED, R.REJECTED, R.CANCELLED],
  [R.PENDING]: [R.APPROVED, R.RETURNED, R.REJECTED, R.CANCELLED],
  [R.RETURNED]: [R.SUBMITTED, R.CANCELLED],
  [R.APPROVED]: [R.IN_PROGRESS, R.RECEIVED, R.COMPLETED, R.CANCELLED],
  [R.IN_PROGRESS]: [R.RECEIVED, R.COMPLETED, R.CANCELLED],
  [R.RECEIVED]: [R.COMPLETED, R.CLOSED],
  [R.COMPLETED]: [R.CLOSED],
});

const createRequestTransitionService = () => new StatusTransitionService().register(ENTITY_TYPES.REQUEST, {
  transitions: requestStatusTransitions, terminalStates: [R.REJECTED, R.CANCELLED, R.CLOSED],
});

module.exports = { StatusTransitionService, StatusTransitionError, requestStatusTransitions, createRequestTransitionService };