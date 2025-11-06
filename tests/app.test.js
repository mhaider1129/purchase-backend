jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

jest.mock('../controllers/utils/reassignPendingApprovals', () => jest.fn().mockResolvedValue());
jest.mock('../controllers/utils/remindPendingApprovals', () => jest.fn().mockResolvedValue());
jest.mock('../utils/storage', () => ({
  getSignedUrl: jest.fn(),
}));

const http = require('http');
const app = require('../app');
const db = require('../config/db');
const { getSignedUrl } = require('../utils/storage');

const makeRequest = (baseUrl, path) => new Promise((resolve, reject) => {
  const req = http.request(`${baseUrl}${path}`, res => {
    let raw = '';
    res.setEncoding('utf8');

    res.on('data', chunk => {
      raw += chunk;
    });

    res.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      resolve({ status: res.statusCode, body });
    });
  });

  req.on('error', reject);
  req.end();
});

describe('Express app', () => {
  let server;
  let baseUrl;

  beforeAll(done => {
    server = http.createServer(app);
    server.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll(done => {
    server.close(done);
  });

  it('responds with OK for the health endpoint', async () => {
    const { status, body } = await makeRequest(baseUrl, '/health');

    expect(status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ status: '✅ OK' }));
  });

  it('returns JSON 404 response for unknown routes', async () => {
    const { status, body } = await makeRequest(baseUrl, '/not-found');

    expect(status).toBe(404);
    expect(body).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('Route not found'),
      })
    );
  });

  it('normalizes double-api prefix in URL', async () => {
    const fileId = '123-abc';
    const fakeFile = {
      id: fileId,
      file_name: 'test.pdf',
      s3_key: 'uploads/test.pdf',
      mime_type: 'application/pdf',
    };
    const fakeSignedUrl = 'https://s3.example.com/signed/uploads/test.pdf';

    db.query.mockResolvedValueOnce({ rows: [fakeFile] });
    getSignedUrl.mockResolvedValueOnce(fakeSignedUrl);

    const { status, body } = await makeRequest(baseUrl, `/api/api/files/${fileId}`);

    expect(status).toBe(200);
    expect(body).toEqual({
      ...fakeFile,
      url: fakeSignedUrl,
    });
    expect(db.query).toHaveBeenCalledWith(expect.any(String), [fileId]);
    expect(getSignedUrl).toHaveBeenCalledWith(fakeFile.s3_key);
  });
});
