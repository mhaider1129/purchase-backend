'use strict';

const request = require('supertest');

jest.mock('../config/db', () => ({
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  connect: jest.fn(),
}));

jest.mock('../middleware/authMiddleware', () => {
  const authenticateUser = (req, _res, next) => {
    if (!req.headers.authorization) return next(Object.assign(new Error('Unauthorized'), { statusCode: 401 }));
    req.user = {
      id: 7, institute_id: 3, role: 'tester', permissions: ['ai-intelligence.use'],
      data_scopes: { institute_ids: ['3'] }, hasPermission: code => code === 'ai-intelligence.use',
    };
    return next();
  };
  return { authenticateUser, authenticateUserOptional: authenticateUser };
});

describe('app.js AI integration with Ollama unavailable', () => {
  let app;
  beforeAll(() => {
    process.env.AI_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:9';
    process.env.AI_TIMEOUT_MS = '1000';
    app = require('../app');
  });

  test('app boots without a running Ollama and the AI routes are protected', async () => {
    expect(app).toBeDefined();
    await request(app).get('/api/ai/health').expect(401);
    await request(app).post('/api/ai/chat').send({ message: 'hello' }).expect(401);
  });

  test('authenticated health reaches the AI controller and reports unavailable', async () => {
    const response = await request(app).get('/api/ai/health').set('Authorization', 'Bearer test');
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: 'unavailable', provider: 'ollama' });
  });

  test('authenticated chat route exists and audit/provider unavailability is controlled', async () => {
    const response = await request(app).post('/api/ai/chat').set('Authorization', 'Bearer test').send({ message: 'hello' });
    expect(response.status).toBe(503);
    expect(response.status).not.toBe(404);
  });

  test('an unrelated authenticated API route still works', async () => {
    const response = await request(app).get('/api/departments').set('Authorization', 'Bearer test');
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  test('the AI route module can be required directly', () => {
    expect(require('../modules/ai-intelligence/routes').createAiRouter).toEqual(expect.any(Function));
  });
});