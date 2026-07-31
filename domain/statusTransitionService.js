class StatusTransitionError extends Error {
  constructor(message, code) { super(message); this.name = 'StatusTransitionError'; this.code = code; }
}

class StatusTransitionService {
  constructor() { this.registry = new Map(); }
  register(entityType, { transitions, terminalStates = [] }) {
    if (!entityType || !transitions || typeof transitions !== 'object') throw new TypeError('entityType and transitions are required');
    const normalized = new Map(Object.entries(transitions).map(([state, next]) => [state, new Set(next)]));
    this.registry.set(entityType, { transitions: normalized, terminalStates: new Set(terminalStates) });
    return this;
  }
  validate({ entityType, currentState, nextState, actor = null, reason = null }) {
    const definition = this.registry.get(entityType);
    if (!definition) throw new StatusTransitionError(`Unregistered entity type: ${entityType}`, 'UNKNOWN_ENTITY_TYPE');
    if (!definition.transitions.has(currentState) && !definition.terminalStates.has(currentState)) {
      throw new StatusTransitionError(`Unknown current state: ${currentState}`, 'UNKNOWN_CURRENT_STATE');
    }
    if (definition.terminalStates.has(currentState)) throw new StatusTransitionError(`State is terminal: ${currentState}`, 'TERMINAL_STATE');
    if (!definition.transitions.get(currentState)?.has(nextState)) {
      throw new StatusTransitionError(`Invalid transition from ${currentState} to ${nextState}`, 'INVALID_TRANSITION');
    }
    return Object.freeze({ entityType, from: currentState, to: nextState, actor, reason, terminal: definition.terminalStates.has(nextState) });
  }
}

module.exports = { StatusTransitionService, StatusTransitionError };