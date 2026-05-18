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

const makeRequest = (baseUrl, path, options = {}) => new Promise((resolve, reject) => {
  const req = http.request(`${baseUrl}${path}`, options, res => {
    let raw = '';
    res.setEncoding('utf8');

    res.on('data', chunk => {
      raw += chunk;
    });

    res.on('end', () => {
      const contentType = res.headers['content-type'] || '';
      const body = raw && contentType.includes('application/json') ? JSON.parse(raw) : raw || null;
      resolve({ status: res.statusCode, body, headers: res.headers });
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

  it('responds with OK for the health endpoint and includes request tracing id', async () => {
    const { status, body, headers } = await makeRequest(baseUrl, '/health');

    expect(status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ status: '✅ OK' }));
    expect(body.requestId).toEqual(expect.any(String));
    expect(headers['x-request-id']).toBe(body.requestId);
  });

  it('uses incoming x-request-id header when provided', async () => {
    const requestId = 'starter-pack-request-id';
    const { status, headers, body } = await makeRequest(baseUrl, '/health', {
      headers: {
        'x-request-id': requestId,
      },
    });

    expect(status).toBe(200);
    expect(headers['x-request-id']).toBe(requestId);
    expect(body.requestId).toBe(requestId);
  });

  it('returns service metrics in text format', async () => {
    const { status, body, headers } = await makeRequest(baseUrl, '/metrics');

    expect(status).toBe(200);
    expect(headers['content-type']).toContain('text/plain');
    expect(body).toEqual(expect.stringContaining('http_requests_total'));
    expect(body).toEqual(expect.stringContaining('service_uptime_seconds'));
  });

  it('returns error budget summary', async () => {
    const { status, body } = await makeRequest(baseUrl, '/error-budget');

    expect(status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        success: true,
        errorBudget: expect.objectContaining({
          targetAvailabilityPercent: expect.any(Number),
          requestsTotal: expect.any(Number),
          errorsTotal: expect.any(Number),
          breached: expect.any(Boolean),
        }),
      })
    );
  });

  it('exposes auth routes under the api prefix', async () => {
    const rootResponse = await makeRequest(baseUrl, '/auth/login', { method: 'POST' });
    const apiResponse = await makeRequest(baseUrl, '/api/auth/login', { method: 'POST' });
    const doubleApiResponse = await makeRequest(baseUrl, '/api/api/auth/login', { method: 'POST' });

    expect(apiResponse.status).toBe(rootResponse.status);
    expect(apiResponse.body.message).toBe(rootResponse.body.message);
    expect(doubleApiResponse.status).toBe(rootResponse.status);
    expect(doubleApiResponse.body.message).toBe(rootResponse.body.message);
  });

  it('supports root aliases for protected routes when proxies strip the api prefix', async () => {
    const routePairs = [
      ['/api/users/me', '/users/me'],
      ['/api/ui-access', '/ui-access'],
      ['/api/notifications?unreadOnly=true&limit=50', '/notifications?unreadOnly=true&limit=50'],
    ];

    for (const [apiPath, rootAliasPath] of routePairs) {
      const apiResponse = await makeRequest(baseUrl, apiPath);
      const aliasResponse = await makeRequest(baseUrl, rootAliasPath);

      expect(aliasResponse.status).toBe(apiResponse.status);
      expect(aliasResponse.body.message).toBe(apiResponse.body.message);
      expect(aliasResponse.body.requestId).toEqual(expect.any(String));
    }
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

    const normalResponse = await makeRequest(baseUrl, `/api/files/${fileId}`);
    const aliasedResponse = await makeRequest(baseUrl, `/api/api/files/${fileId}`);

    expect(aliasedResponse.status).toBe(normalResponse.status);
    expect(aliasedResponse.body.message).toBe(normalResponse.body.message);
    expect(aliasedResponse.body.requestId).toEqual(expect.any(String));
  });
});