const { ensureLifecycleRow, transitionLifecycleState } = require('../services/lifecycleTransitionService');
const { LIFECYCLE_STATES } = require('../services/procureToPayService');

describe('lifecycleTransitionService', () => {
  it('ensures lifecycle row using default draft state', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const client = { query };

    await ensureLifecycleRow(client, 10, 5);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO procurement_lifecycle_states'),
      [10, LIFECYCLE_STATES.DRAFT_PR, 5]
    );
  });

  it('transitions when state change is valid', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ procurement_state: LIFECYCLE_STATES.MATCH_PENDING }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const client = { query };

    await transitionLifecycleState(client, 11, LIFECYCLE_STATES.MATCH_VERIFIED, 3, 'ok', { source: 'test' });

    expect(query).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE procurement_lifecycle_states'),
      [11, LIFECYCLE_STATES.MATCH_VERIFIED]
    );
  });

  it('throws on invalid transition', async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [{ procurement_state: LIFECYCLE_STATES.PAID }] });
    const client = { query };

    await expect(
      transitionLifecycleState(client, 15, LIFECYCLE_STATES.DRAFT_PR, 1)
    ).rejects.toThrow('Invalid lifecycle transition');
  });
});