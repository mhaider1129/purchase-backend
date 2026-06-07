const {
  DEFAULT_ATTACHMENT_MAX_SIZE_MB,
  BYTES_PER_MB,
  getAttachmentMaxSizeMb,
  getAttachmentMaxSizeBytes,
} = require('../config/uploadLimits');

describe('upload limit configuration', () => {
  const originalValue = process.env.ATTACHMENT_MAX_SIZE_MB;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.ATTACHMENT_MAX_SIZE_MB;
    } else {
      process.env.ATTACHMENT_MAX_SIZE_MB = originalValue;
    }
  });

  it('defaults attachment uploads to 50MB', () => {
    delete process.env.ATTACHMENT_MAX_SIZE_MB;

    expect(DEFAULT_ATTACHMENT_MAX_SIZE_MB).toBe(50);
    expect(getAttachmentMaxSizeMb()).toBe(50);
    expect(getAttachmentMaxSizeBytes()).toBe(50 * BYTES_PER_MB);
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
});