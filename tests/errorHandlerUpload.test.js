const httpMocks = require('node-mocks-http');
const errorHandler = require('../middleware/errorHandler');

describe('upload error handling', () => {
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

  it('returns a clear 413 response for files over the attachment size limit', () => {
    process.env.ATTACHMENT_MAX_SIZE_MB = '50';
    const req = httpMocks.createRequest({ method: 'POST', url: '/api/requests' });
    req.requestId = 'req-123';
    const res = httpMocks.createResponse();
    const err = new Error('File too large');
    err.code = 'LIMIT_FILE_SIZE';

    errorHandler(err, req, res, jest.fn());

    expect(res.statusCode).toBe(413);
    expect(res._getJSONData()).toEqual({
      success: false,
      message: 'Attachment is too large. Maximum file size is 50MB.',
      requestId: 'req-123',
    });
  });

  it('returns a clear 413 response for oversized JSON request bodies', () => {
    process.env.REQUEST_BODY_LIMIT_MB = '75';
    const req = httpMocks.createRequest({ method: 'POST', url: '/api/requests' });
    req.requestId = 'req-456';
    const res = httpMocks.createResponse();
    const err = new Error('request entity too large');
    err.type = 'entity.too.large';

    errorHandler(err, req, res, jest.fn());

    expect(res.statusCode).toBe(413);
    expect(res._getJSONData()).toEqual({
      success: false,
      message: 'Request payload is too large. Maximum non-attachment request body size is 75MB.',
      requestId: 'req-456',
    });
  });

  it('returns a clear 413 response for too many uploaded files', () => {
    process.env.ATTACHMENT_MAX_FILES = '3';
    const req = httpMocks.createRequest({ method: 'POST', url: '/api/requests' });
    req.requestId = 'req-789';
    const res = httpMocks.createResponse();
    const err = new Error('Too many files');
    err.code = 'LIMIT_FILE_COUNT';

    errorHandler(err, req, res, jest.fn());

    expect(res.statusCode).toBe(413);
    expect(res._getJSONData()).toEqual({
      success: false,
      message: 'Too many attachments. Maximum number of files is 3.',
      requestId: 'req-789',
    });
  });
});