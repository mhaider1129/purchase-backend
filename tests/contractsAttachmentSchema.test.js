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

  it('rejects missing contract_id without runtime schema repair', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await expect(ensureAttachmentsContractIdColumn(queryable)).rejects.toMatchObject({code:'DATABASE_MODULE_CONTRACT_MISSING',statusCode:503});
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][0]).toMatch(/^SELECT/);
    await expect(ensureAttachmentsContractIdColumn(queryable)).rejects.toMatchObject({code:'DATABASE_MODULE_CONTRACT_MISSING'});
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
