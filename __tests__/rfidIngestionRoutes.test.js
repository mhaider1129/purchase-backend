const express = require('express');
const request = require('supertest');

const mockAuthenticateService = jest.fn((_req, _res, next) => next());
const mockIngest = jest.fn((_req, res) => res.status(202).json({ accepted: 1 }));

jest.mock('../controllers/rfidController', () => ({
  authenticateService: mockAuthenticateService,
  ingest: mockIngest,
}));

const ingestionRoutes = require('../routes/rfidIngestion');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/rfid', ingestionRoutes);
  app.get('/api/rfid/:resource', (req, res) => res.json({ resource: req.params.resource }));
  return app;
}

describe('RFID ingestion route isolation', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each(['events', 'readers', 'portals', 'exceptions'])(
    'allows the human-user %s route to continue past the ingestion router',
    async (resource) => {
      const response = await request(buildApp()).get(`/api/rfid/${resource}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ resource });
      expect(mockAuthenticateService).not.toHaveBeenCalled();
    },
  );

  test.each(['/read-events', '/read-events/batch'])(
    'still authenticates service ingestion at %s',
    async (path) => {
      const response = await request(buildApp())
        .post(`/api/rfid${path}`)
        .send({ epc: 'E2000017221101441890ABCD' });

      expect(response.status).toBe(202);
      expect(mockAuthenticateService).toHaveBeenCalledTimes(1);
      expect(mockIngest).toHaveBeenCalledTimes(1);
    },
  );
});