jest.mock('../utils/attachmentSchema', () => ({
  insertAttachment: jest.fn(),
  attachmentsHasItemIdColumn: jest.fn(),
}));

jest.mock('../utils/storage', () => ({
  uploadBuffer: jest.fn(async ({ file }) => ({ objectKey: `stored:${file.originalname}` })),
}));

const {
  insertAttachment,
  attachmentsHasItemIdColumn,
} = require('../utils/attachmentSchema');

const {
  persistRequestAttachments,
  groupUploadedFiles,
} = require('../controllers/requests/saveRequestAttachments');

const { uploadBuffer } = require('../utils/storage');

describe('saveRequestAttachments helper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('groups uploaded files by request and item fields', () => {
    const files = [
      { fieldname: 'attachments', originalname: 'general.pdf' },
      { fieldname: 'item_0', originalname: 'spec-a.pdf' },
      { fieldname: 'item_1', originalname: 'spec-b.pdf' },
      { fieldname: 'ignored', originalname: 'ignore.pdf' },
      { fieldname: 'item_not_number', originalname: 'bad.pdf' },
    ];

    const { requestFiles, itemFiles } = groupUploadedFiles(files);

    expect(requestFiles).toHaveLength(1);
    expect(requestFiles[0].originalname).toBe('general.pdf');
    expect(itemFiles[0]).toHaveLength(1);
    expect(itemFiles[0][0].originalname).toBe('spec-a.pdf');
    expect(itemFiles[1]).toHaveLength(1);
    expect(itemFiles[1][0].originalname).toBe('spec-b.pdf');
    expect(itemFiles).not.toHaveProperty('not');
  });

  it('stores item attachments as request-level when schema lacks item_id', async () => {
    attachmentsHasItemIdColumn.mockResolvedValue(false);

    const client = { id: 'mock-client' };
    const files = [
      { fieldname: 'item_0', originalname: 'quote.pdf', buffer: Buffer.from('file') },
    ];

    const stored = await persistRequestAttachments({
      client,
      requestId: 101,
      requesterId: 12,
      itemIdMap: { 0: 555 },
      files,
    });

    expect(stored).toBe(1);
    expect(uploadBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({ originalname: 'quote.pdf' }),
        segments: expect.arrayContaining(['request-101']),
      })
    );
    expect(insertAttachment).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        requestId: 101,
        itemId: null,
        fileName: 'quote.pdf',
        filePath: 'stored:quote.pdf',
        uploadedBy: 12,
      }),
    );
  });

  it('preserves item binding when schema supports item_id', async () => {
    attachmentsHasItemIdColumn.mockResolvedValue(true);

    const client = { id: 'mock-client' };
    const files = [
      { fieldname: 'item_0', originalname: 'image.png', buffer: Buffer.from('file') },
    ];

    const stored = await persistRequestAttachments({
      client,
      requestId: 77,
      requesterId: 3,
      itemIdMap: { 0: 9001 },
      files,
    });

    expect(stored).toBe(1);
    expect(uploadBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({ originalname: 'image.png' }),
        segments: expect.arrayContaining(['request-77', 'item-9001']),
      })
    );
    expect(insertAttachment).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        requestId: 77,
        itemId: 9001,
        fileName: 'image.png',
        filePath: 'stored:image.png',
        uploadedBy: 3,
      }),
    );
  });

  it('skips item attachments when schema supports item_id but item was not created', async () => {
    attachmentsHasItemIdColumn.mockResolvedValue(true);

    const client = { id: 'mock-client' };
    const files = [
      { fieldname: 'item_5', originalname: 'extra.txt', buffer: Buffer.from('file') },
    ];

    const stored = await persistRequestAttachments({
      client,
      requestId: 55,
      requesterId: 2,
      itemIdMap: {},
      files,
    });

    expect(stored).toBe(0);
    expect(insertAttachment).not.toHaveBeenCalled();
  });

  it('returns zero when there are no files', async () => {
    const stored = await persistRequestAttachments({
      client: {},
      requestId: 1,
      requesterId: 1,
      itemIdMap: {},
      files: [],
    });

    expect(stored).toBe(0);
    expect(insertAttachment).not.toHaveBeenCalled();
    expect(attachmentsHasItemIdColumn).not.toHaveBeenCalled();
  });
});