const {
  attachmentsHasContractIdColumn,
  ensureAttachmentsContractIdColumn,
  resetAttachmentsContractIdSupportCache,
} = require('../utils/contractsAttachmentSchema');

describe('contracts attachment schema helpers', () => {
  let queryMock;
  let queryable;

  beforeEach(() => {
    resetAttachmentsContractIdSupportCache();
    queryMock = jest.fn();
    queryable = { query: queryMock };
  });

  it('detects when contract_id column already exists', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{}] });

    const supported = await ensureAttachmentsContractIdColumn(queryable);

    expect(supported).toBe(true);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('adds the contract_id column and index when missing', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{}] });

    const supported = await ensureAttachmentsContractIdColumn(queryable);

    expect(supported).toBe(true);
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('ALTER TABLE')
    );
    expect(queryMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('CREATE INDEX')
    );
  });

  it('caches failures when ensuring the contract_id column is not possible', async () => {
    const error = new Error('boom');
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(error);

    const supported = await ensureAttachmentsContractIdColumn(queryable);

    expect(supported).toBe(false);
    expect(queryMock).toHaveBeenCalledTimes(2);

    queryMock.mockClear();

    const secondCheck = await attachmentsHasContractIdColumn(queryable);

    expect(secondCheck).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });
});