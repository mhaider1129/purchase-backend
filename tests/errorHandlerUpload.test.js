const httpMocks = require('node-mocks-http');
const errorHandler = require('../middleware/errorHandler');

describe('upload error handling', () => {
  const originalValue = process.env.ATTACHMENT_MAX_SIZE_MB;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.ATTACHMENT_MAX_SIZE_MB;
    } else {
      process.env.ATTACHMENT_MAX_SIZE_MB = originalValue;
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
});