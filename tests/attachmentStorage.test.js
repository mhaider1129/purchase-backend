jest.mock('../utils/storage', () => ({
  uploadBuffer: jest.fn(async ({ file, segments }) => ({
    objectKey: `${segments.join('/')}/${file.originalname}`,
    bucket: 'attachments',
  })),
  isStorageConfigured: jest.fn(() => true),
}));

const { uploadBuffer, isStorageConfigured } = require('../utils/storage');
const { storeAttachmentFile } = require('../utils/attachmentStorage');

describe('attachmentStorage helper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isStorageConfigured.mockReturnValue(true);
  });

  it('delegates to Supabase storage when configured', async () => {
    const file = { originalname: 'supabase.pdf', buffer: Buffer.from('123') };
    const result = await storeAttachmentFile({ file, requestId: 10, itemId: null });

    expect(uploadBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({ originalname: 'supabase.pdf' }),
        segments: ['request-10'],
      })
    );
    expect(result.storage).toBe('supabase');
    expect(result.objectKey).toBe('request-10/supabase.pdf');
  });

  it('throws when Supabase storage is not configured', async () => {
    isStorageConfigured.mockReturnValue(false);
    const file = { originalname: 'local.png', buffer: Buffer.from('data') };

    await expect(storeAttachmentFile({ file, requestId: 5, itemId: 8 })).rejects.toMatchObject({
      code: 'SUPABASE_NOT_CONFIGURED',
    });
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('throws when the incoming file buffer is empty', async () => {
    await expect(
      storeAttachmentFile({ file: { originalname: 'empty.txt', buffer: Buffer.alloc(0) } })
    ).rejects.toMatchObject({ code: 'ATTACHMENT_EMPTY_FILE' });
  });
});