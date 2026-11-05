const {
  attachmentsHasItemIdColumn,
  ensureAttachmentsItemIdColumn,
  resetAttachmentsItemIdSupportCache,
} = require('../utils/attachmentSchema');

describe('attachment schema helpers', () => {
  let queryMock;
  let queryable;

  beforeEach(() => {
    resetAttachmentsItemIdSupportCache();
    queryMock = jest.fn();
    queryable = { query: queryMock };
  });

  it('detects when item_id column already exists', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{}] });

    const supported = await ensureAttachmentsItemIdColumn(queryable);

    expect(supported).toBe(true);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('rejects missing item_id without runtime schema repair', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await expect(ensureAttachmentsItemIdColumn(queryable)).rejects.toMatchObject({code:'DATABASE_MODULE_CONTRACT_MISSING',statusCode:503});
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][0]).toMatch(/^SELECT/);
    await expect(ensureAttachmentsItemIdColumn(queryable)).rejects.toMatchObject({code:'DATABASE_MODULE_CONTRACT_MISSING'});
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
