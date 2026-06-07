const {
  DEFAULT_ATTACHMENT_MAX_FILES,
  DEFAULT_ATTACHMENT_MAX_SIZE_MB,
  BYTES_PER_MB,
  getAttachmentMaxFiles,
  getAttachmentMaxSizeMb,
  getAttachmentMaxSizeBytes,
  getRequestBodyLimit,
  getRequestBodyLimitMb,
} = require('../config/uploadLimits');

describe('upload limit configuration', () => {
  const originalAttachmentMaxSizeMb = process.env.ATTACHMENT_MAX_SIZE_MB;
  const originalAttachmentMaxFiles = process.env.ATTACHMENT_MAX_FILES;
  const originalRequestBodyLimitMb = process.env.REQUEST_BODY_LIMIT_MB;

  afterEach(() => {
    if (originalAttachmentMaxSizeMb === undefined) {
      delete process.env.ATTACHMENT_MAX_SIZE_MB;
    } else {
      process.env.ATTACHMENT_MAX_SIZE_MB = originalAttachmentMaxSizeMb;
    }

    if (originalAttachmentMaxFiles === undefined) {
      delete process.env.ATTACHMENT_MAX_FILES;
    } else {
      process.env.ATTACHMENT_MAX_FILES = originalAttachmentMaxFiles;
    }

    if (originalRequestBodyLimitMb === undefined) {
      delete process.env.REQUEST_BODY_LIMIT_MB;
    } else {
      process.env.REQUEST_BODY_LIMIT_MB = originalRequestBodyLimitMb;
    }
  });

  it('defaults attachment uploads to 50MB', () => {
    delete process.env.ATTACHMENT_MAX_SIZE_MB;
    delete process.env.ATTACHMENT_MAX_FILES;
    delete process.env.REQUEST_BODY_LIMIT_MB;

    expect(DEFAULT_ATTACHMENT_MAX_SIZE_MB).toBe(50);
    expect(DEFAULT_ATTACHMENT_MAX_FILES).toBe(20);
    expect(getAttachmentMaxSizeMb()).toBe(50);
    expect(getAttachmentMaxSizeBytes()).toBe(50 * BYTES_PER_MB);
    expect(getAttachmentMaxFiles()).toBe(20);
    expect(getRequestBodyLimitMb()).toBe(50);
    expect(getRequestBodyLimit()).toBe('50mb');
  });

  it('allows deployments to increase the attachment upload limit with an environment variable', () => {
    process.env.ATTACHMENT_MAX_SIZE_MB = '75';

    expect(getAttachmentMaxSizeMb()).toBe(75);
    expect(getAttachmentMaxSizeBytes()).toBe(75 * BYTES_PER_MB);
  });

  it('falls back to the default when the environment variable is invalid', () => {
    process.env.ATTACHMENT_MAX_SIZE_MB = 'not-a-number';

    expect(getAttachmentMaxSizeMb()).toBe(DEFAULT_ATTACHMENT_MAX_SIZE_MB);
    expect(getAttachmentMaxSizeBytes()).toBe(DEFAULT_ATTACHMENT_MAX_SIZE_MB * BYTES_PER_MB);
  });

  it('allows deployments to tune total body and attachment count limits', () => {
    process.env.REQUEST_BODY_LIMIT_MB = '100';
    process.env.ATTACHMENT_MAX_FILES = '35';

    expect(getRequestBodyLimitMb()).toBe(100);
    expect(getRequestBodyLimit()).toBe('100mb');
    expect(getAttachmentMaxFiles()).toBe(35);
  });
});