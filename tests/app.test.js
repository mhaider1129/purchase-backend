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
  it('serves deployment identity through the actual same-origin API route without opening protected auth', async () => {
    const beforeRelease = process.env.APP_RELEASE_REF;
    const beforeWorkers = process.env.RUNTIME_BACKGROUND_WORKERS_ENABLED;
    try {
      process.env.APP_RELEASE_REF = 'a'.repeat(40);
      process.env.RUNTIME_BACKGROUND_WORKERS_ENABLED = 'false';
      const response = await makeRequest(baseUrl, '/api/health');
      expect(response.status).toBe(200);
      expect(response.body).toEqual(expect.objectContaining({ release: 'a'.repeat(40), workers: false }));
      expect((await makeRequest(baseUrl, '/api/auth/me')).status).toBe(401);
    } finally {
      if (beforeRelease === undefined) delete process.env.APP_RELEASE_REF; else process.env.APP_RELEASE_REF = beforeRelease;
      if (beforeWorkers === undefined) delete process.env.RUNTIME_BACKGROUND_WORKERS_ENABLED; else process.env.RUNTIME_BACKGROUND_WORKERS_ENABLED = beforeWorkers;
    }
  });
  it('rejects invalid worker configuration before attempting startup', async () => {
    const before = process.env.RUNTIME_BACKGROUND_WORKERS_ENABLED;
    try {
      process.env.RUNTIME_BACKGROUND_WORKERS_ENABLED = 'invalid';
      await expect(app.startServer()).rejects.toMatchObject({ code: 'INVALID_WORKER_CONFIGURATION' });
    } finally {
      if (before === undefined) delete process.env.RUNTIME_BACKGROUND_WORKERS_ENABLED; else process.env.RUNTIME_BACKGROUND_WORKERS_ENABLED = before;
    }
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

  it('exposes auth routes only under the api prefix', async () => {
    const rootResponse = await makeRequest(baseUrl, '/auth/login', { method: 'POST' });
    const apiResponse = await makeRequest(baseUrl, '/api/auth/login', { method: 'POST' });
    const doubleApiResponse = await makeRequest(baseUrl, '/api/api/auth/login', { method: 'POST' });

    expect(apiResponse.status).toBe(400);
    expect(apiResponse.body.message).toBe('Login identifier and password are required');
    expect(rootResponse.status).toBe(404);
    expect(doubleApiResponse.status).toBe(404);
  });

  it('mounts protected routes under a single api prefix', async () => {
    const protectedPaths = [
      '/files',
      '/requests',
      '/requested-items',
      '/approvals',
      '/audit-log',
      '/attachments',
      '/admin-tools',
      '/users',
      '/dashboard',
      '/departments',
      '/warehouses',
      '/roles',
      '/permissions',
      '/procurement-plans',
      '/planning',
      '/stock-items',
      '/stock-item-requests',
      '/item-master',
      '/warehouse-inventory',
      '/item-recalls',
      '/warehouse-supply',
      '/warehouse-transfers',
      '/approval-routes',
      '/approval-policies',
      '/approval-policies/7',
      '/approval-policy-versions/7',
      '/approval-policy-shadow-runs/7',
      '/approval-policy-readiness',
      '/approval-authority-delegations',
      '/warehouse-supply-templates',
      '/projects',
      '/custody',
      '/contracts',
      '/suppliers',
      '/supplier-evaluations',
      '/supplier-srm',
      '/technical-inspections',
      '/contract-evaluations',
      '/risk-management',
      '/ui-access',
      '/capability-policies',
      '/notifications',
      '/dispensing',
      '/procure-to-pay',
      '/audit-registry',
      '/tasks',
      '/budget-control',
      '/request-auto-assignment-rules',
      '/department-requested-items',
      '/procurement-evaluations',
      '/print-service-requests',
    ];

    for (const protectedPath of protectedPaths) {
      const apiResponse = await makeRequest(baseUrl, `/api${protectedPath}`);
      const rootResponse = await makeRequest(baseUrl, protectedPath);
      const doubleApiResponse = await makeRequest(baseUrl, `/api/api${protectedPath}`);

      expect(apiResponse.status).toBe(401);
      expect(apiResponse.body.message).toBe('Unauthorized: Missing or malformed token');
      expect(rootResponse.status).toBe(404);
      expect(doubleApiResponse.status).toBe(404);
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

  it('does not normalize a double-api prefix', async () => {
    const fileId = '123-abc';

    const normalResponse = await makeRequest(baseUrl, `/api/files/${fileId}`);
    const aliasedResponse = await makeRequest(baseUrl, `/api/api/files/${fileId}`);

    expect(normalResponse.status).toBe(401);
    expect(aliasedResponse.status).toBe(404);
    expect(aliasedResponse.body.message).toContain('Route not found');
  });
});
