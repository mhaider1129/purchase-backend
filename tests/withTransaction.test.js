const withTransaction = require('../utils/withTransaction');

describe('withTransaction', () => {
  test('commits and releases on success', async () => {
    const client = { query: jest.fn().mockResolvedValue(), release: jest.fn() };
    await expect(withTransaction(async db => { expect(db).toBe(client); return 4; }, { pool: { connect: jest.fn().mockResolvedValue(client) } })).resolves.toBe(4);
    expect(client.query.mock.calls.map(call => call[0])).toEqual(['BEGIN', 'COMMIT']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
  test('rolls back, releases, and preserves the original error', async () => {
    const original = new Error('business failure');
    const client = { query: jest.fn().mockResolvedValue(), release: jest.fn() };
    await expect(withTransaction(async () => { throw original; }, { pool: { connect: jest.fn().mockResolvedValue(client) } })).rejects.toBe(original);
    expect(client.query.mock.calls.map(call => call[0])).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
  test('uses an existing client without transaction control', async () => {
    const client = { query: jest.fn() };
    await expect(withTransaction(() => 'nested', { client })).resolves.toBe('nested');
    expect(client.query).not.toHaveBeenCalled();
  });
});