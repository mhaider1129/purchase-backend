jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(),
  writeFile: jest.fn().mockResolvedValue(),
}));

jest.mock('../utils/storage', () => ({
  uploadBuffer: jest.fn(async ({ file, segments }) => ({
    objectKey: `${segments.join('/')}/${file.originalname}`,
    bucket: 'attachments',
  })),
  isStorageConfigured: jest.fn(() => true),
}));

const { uploadBuffer, isStorageConfigured } = require('../utils/storage');
const fs = require('fs/promises');
const path = require('path');
const { storeAttachmentFile, isLocalFallbackEnabled } = require('../utils/attachmentStorage');

describe('attachmentStorage helper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ATTACHMENT_LOCAL_FALLBACK_ENABLED;
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
    expect(fs.mkdir).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('stores files locally when Supabase storage is not configured', async () => {
    isStorageConfigured.mockReturnValue(false);
    const file = { originalname: 'local.png', buffer: Buffer.from('data') };

    const result = await storeAttachmentFile({ file, requestId: 5, itemId: 8 });

    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(fs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining(path.join('uploads', 'request-5', 'item-8')),
      { recursive: true }
    );
    expect(fs.writeFile).toHaveBeenCalled();
    expect(result.storage).toBe('local');
    expect(result.objectKey).toMatch(/^uploads\//);
  });

  it('returns a shared-storage error when Supabase upload fails by default', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    uploadBuffer.mockRejectedValueOnce(new Error('bucket policy blocked'));
    const file = { originalname: 'fallback.pdf', buffer: Buffer.from('data') };

    await expect(storeAttachmentFile({ file, requestId: 6, itemId: null })).rejects.toMatchObject({
      code: 'ATTACHMENT_SHARED_STORAGE_UPLOAD_FAILED',
      statusCode: 502,
    });

    expect(uploadBuffer).toHaveBeenCalled();
    expect(fs.mkdir).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to store attachment in shared Supabase storage')
    );

    errorSpy.mockRestore();
  });

  it('falls back to local storage when explicitly enabled and Supabase upload fails', async () => {
    process.env.ATTACHMENT_LOCAL_FALLBACK_ENABLED = 'true';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    uploadBuffer.mockRejectedValueOnce(new Error('bucket policy blocked'));
    const file = { originalname: 'fallback.pdf', buffer: Buffer.from('data') };

    const result = await storeAttachmentFile({ file, requestId: 6, itemId: null });

    expect(uploadBuffer).toHaveBeenCalled();
    expect(fs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining(path.join('uploads', 'request-6')),
      { recursive: true }
    );
    expect(fs.writeFile).toHaveBeenCalled();
    expect(result.storage).toBe('local');
    expect(result.objectKey).toMatch(/^uploads\/request-6\//);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to store attachment in Supabase; falling back to local filesystem storage')
    );

    warnSpy.mockRestore();
  });

  it('only enables local fallback for explicit truthy values', () => {
    expect(isLocalFallbackEnabled()).toBe(false);
    process.env.ATTACHMENT_LOCAL_FALLBACK_ENABLED = 'yes';
    expect(isLocalFallbackEnabled()).toBe(true);
    process.env.ATTACHMENT_LOCAL_FALLBACK_ENABLED = 'false';
    expect(isLocalFallbackEnabled()).toBe(false);
  });

  it('throws when the incoming file buffer is empty', async () => {
    await expect(
      storeAttachmentFile({ file: { originalname: 'empty.txt', buffer: Buffer.alloc(0) } })
    ).rejects.toMatchObject({ code: 'ATTACHMENT_EMPTY_FILE' });
  });
});