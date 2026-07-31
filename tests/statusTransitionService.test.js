const { StatusTransitionService, StatusTransitionError } = require('../domain/statusTransitionService');

describe('StatusTransitionService', () => {
  const service = () => new StatusTransitionService().register('request', {
    transitions: { Pending: ['Approved', 'Rejected'], Approved: ['Completed'] },
    terminalStates: ['Rejected', 'Completed'],
  });
  test('returns structured transition context', () => {
    expect(service().validate({ entityType: 'request', currentState: 'Pending', nextState: 'Approved', actor: { id: 7 }, reason: 'reviewed' }))
      .toEqual({ entityType: 'request', from: 'Pending', to: 'Approved', actor: { id: 7 }, reason: 'reviewed', terminal: false });
  });
  test('rejects invalid transitions', () => expect(() => service().validate({ entityType: 'request', currentState: 'Pending', nextState: 'Completed' })).toThrow(StatusTransitionError));
  test('rejects transitions out of terminal states', () => expect(() => service().validate({ entityType: 'request', currentState: 'Rejected', nextState: 'Pending' })).toThrow(expect.objectContaining({ code: 'TERMINAL_STATE' })));
});