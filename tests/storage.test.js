const ORIGINAL_FETCH = global.fetch;

describe('Supabase storage configuration utilities', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_STORAGE_BUCKET;
    delete process.env.SUPABASE_STORAGE_PREFIX;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  afterEach(() => {
    if (ORIGINAL_FETCH) {
      global.fetch = ORIGINAL_FETCH;
    } else {
      delete global.fetch;
    }
  });

  it('reports storage as not configured when env values are missing', () => {
    const storage = require('../utils/storage');
    expect(storage.isStorageConfigured()).toBe(false);
  });

  it('reads configuration from the environment and trims trailing slashes', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co/';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'role-key';
    process.env.SUPABASE_STORAGE_BUCKET = 'custom-bucket';
    process.env.SUPABASE_STORAGE_PREFIX = 'custom/prefix';

    const storage = require('../utils/storage');
    const config = storage.getStorageConfiguration();

    expect(config).toMatchObject({
      url: 'https://example.supabase.co',
      key: 'role-key',
      bucket: 'custom-bucket',
      prefix: 'custom/prefix',
    });
    expect(storage.isStorageConfigured()).toBe(true);
  });

  it('uses anon key when service role key is absent', () => {
    process.env.SUPABASE_URL = 'https://anon.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';

    const storage = require('../utils/storage');
    expect(storage.isStorageConfigured()).toBe(true);
    expect(storage.getStorageConfiguration().key).toBe('anon-key');
  });

  it('reflects runtime environment changes without reloading the module', () => {
    const storage = require('../utils/storage');
    expect(storage.isStorageConfigured()).toBe(false);

    process.env.SUPABASE_URL = 'https://runtime.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'runtime-key';

    expect(storage.isStorageConfigured()).toBe(true);
  });

  it('applies default prefix from configuration when building object keys', () => {
    process.env.SUPABASE_URL = 'https://prefix.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'prefix-key';
    process.env.SUPABASE_STORAGE_PREFIX = 'attachments/prefix';

    const { buildObjectKey } = require('../utils/storage');
    const key = buildObjectKey('report.pdf', { segments: ['request-1'] });

    expect(key.startsWith('attachments/prefix/')).toBe(true);
    expect(key).toContain('request-1');
    expect(key.endsWith('.pdf')).toBe(true);
  });

  it('creates the configured bucket automatically when it is missing', async () => {
    process.env.SUPABASE_URL = 'https://bucket.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'bucket-key';

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not Found',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'Created',
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '',
      });

    global.fetch = fetchMock;

    const storage = require('../utils/storage');
    const result = await storage.uploadBuffer({
      file: { originalname: 'doc.txt', buffer: Buffer.from('hello'), mimetype: 'text/plain' },
    });

    expect(result.bucket).toBe('attachments');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://bucket.supabase.co/storage/v1/bucket/attachments',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer bucket-key',
          apikey: 'bucket-key',
        }),
      })
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://bucket.supabase.co/storage/v1/bucket',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );

    expect(fetchMock.mock.calls[2][0]).toMatch(
      /https:\/\/bucket\.supabase\.co\/storage\/v1\/object\/attachments\//
    );
  });

  it('propagates errors when the bucket cannot be created', async () => {
    process.env.SUPABASE_URL = 'https://bucket.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'bucket-key';

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not Found',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'policy blocked',
      });

    global.fetch = fetchMock;

    const storage = require('../utils/storage');

    await expect(
      storage.uploadBuffer({
        file: { originalname: 'doc.txt', buffer: Buffer.from('hello'), mimetype: 'text/plain' },
      })
    ).rejects.toMatchObject({ code: 'SUPABASE_BUCKET_CREATE_FAILED' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});