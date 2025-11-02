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

  it('adds the item_id column and index when missing', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{}] });

    const supported = await ensureAttachmentsItemIdColumn(queryable);

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

  it('caches failures when ensuring the column is not possible', async () => {
    const error = new Error('boom');
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(error);

    const supported = await ensureAttachmentsItemIdColumn(queryable);

    expect(supported).toBe(false);
    expect(queryMock).toHaveBeenCalledTimes(2);

    queryMock.mockClear();

    const secondCheck = await attachmentsHasItemIdColumn(queryable);

    expect(secondCheck).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });
});