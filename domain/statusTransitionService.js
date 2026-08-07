const { ENTITY_TYPES, REQUEST_STATUS: R, normalizeStatus } = require('./statusConstants');

class StatusTransitionError extends Error {
  constructor(message, code, details = null, statusCode = 409) { super(message); this.name = 'StatusTransitionError'; this.code = code; this.details = details; this.statusCode = statusCode; }
}

class StatusTransitionService {
  constructor() { this.registry = new Map(); }
  register(entityType, definition) {
    if (typeof entityType !== 'string' || !entityType.trim()) throw new TypeError('entityType must be a non-empty string');
    const normalizedType = entityType.trim().toLowerCase();
    if (!Object.values(ENTITY_TYPES).includes(normalizedType)) throw new TypeError(`Unsupported entityType: ${entityType}`);
    if (this.registry.has(normalizedType)) throw new TypeError(`Entity type already registered: ${normalizedType}`);
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new TypeError('A transition definition object is required');
    const { transitions, terminalStates = [] } = definition;
    if (!transitions || typeof transitions !== 'object' || Array.isArray(transitions)) throw new TypeError('transitions must be an object');
    if (!Array.isArray(terminalStates) && !(terminalStates instanceof Set)) throw new TypeError('terminalStates must be an array or Set');
    const normalizedTransitions = new Map();
    for (const [rawSource, rawDestinations] of Object.entries(transitions)) {
      const source = normalizeStatus(rawSource);
      if (typeof source !== 'string' || !source.trim()) throw new TypeError('Transition source states must be non-empty');
      if (!Array.isArray(rawDestinations) && !(rawDestinations instanceof Set)) throw new TypeError(`Destinations for ${source} must be an array or Set`);
      const destinations = [...rawDestinations].map(normalizeStatus);
      if (destinations.some(value => typeof value !== 'string' || !value.trim())) throw new TypeError(`Destinations for ${source} must be non-empty states`);
      if (new Set(destinations).size !== destinations.length) throw new TypeError(`Duplicate normalized destination for ${source}`);
      if (normalizedTransitions.has(source)) throw new TypeError(`Duplicate normalized source state: ${source}`);
      normalizedTransitions.set(source, new Set(destinations));
    }
    const terminals = [...terminalStates].map(normalizeStatus);
    if (terminals.some(value => typeof value !== 'string' || !value.trim())) throw new TypeError('Terminal states must be non-empty');
    if (new Set(terminals).size !== terminals.length) throw new TypeError('Duplicate normalized terminal state');
    const knownStates = new Set([...normalizedTransitions.keys(), ...terminals]);
    for (const [source, destinations] of normalizedTransitions) {
      if (terminals.includes(source) && destinations.size) throw new TypeError(`Terminal state ${source} cannot have destinations`);
      for (const destination of destinations) if (!knownStates.has(destination)) throw new TypeError(`Unknown transition destination: ${destination}`);
    }
    this.registry.set(normalizedType, { transitions: normalizedTransitions, terminalStates: new Set(terminals) });
    return this;
  }
  validate({ entityType, currentState, nextState, actor = null, reason = null, allowIdempotent = false }) {
    const from = normalizeStatus(currentState); const to = normalizeStatus(nextState);
    const definition = this.registry.get(typeof entityType === 'string' ? entityType.trim().toLowerCase() : entityType);
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
  // Late cancellation is deliberately prohibited until a compensation coordinator
  // can reverse procurement, purchase orders, receipts, and inventory commitments.
  [R.APPROVED]: [R.IN_PROGRESS, R.RECEIVED, R.COMPLETED],
  [R.IN_PROGRESS]: [R.RECEIVED, R.COMPLETED],
  [R.RECEIVED]: [R.COMPLETED, R.CLOSED],
  [R.COMPLETED]: [R.CLOSED],
});

const createRequestTransitionService = () => new StatusTransitionService().register(ENTITY_TYPES.REQUEST, {
  transitions: requestStatusTransitions, terminalStates: [R.REJECTED, R.CANCELLED, R.CLOSED],
});

module.exports = { StatusTransitionService, StatusTransitionError, requestStatusTransitions, createRequestTransitionService };