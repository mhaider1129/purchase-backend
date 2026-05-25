jest.mock('../middleware/authMiddleware', () => ({ authenticateUser: (req, res, next) => next() }));
jest.mock('../middleware/upload', () => ({ any: () => (req, res, next) => next() }));
jest.mock('../controllers/contractGovernanceController', () => ({
  getContractHealth: jest.fn(),
  updateContractGovernanceFields: jest.fn(),
}));
jest.mock('../controllers/contractsController', () => new Proxy({}, { get: () => jest.fn() }));

const contractsRouter = require('../routes/contracts');

function flatten(router, base = '') {
  const out = [];
  for (const layer of router.stack) {
    if (layer.route) {
      out.push({
        path: `${base}${layer.route.path}`,
        methods: Object.keys(layer.route.methods),
      });
      continue;
    }

    if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      out.push(...flatten(layer.handle, base));
    }
  }
  return out;
}

describe('contracts route ordering', () => {
  test('static risk/dashboard routes are registered before dynamic :id/risk', () => {
    const routes = flatten(contractsRouter).filter((r) => r.methods.includes('get'));
    const paths = routes.map((r) => r.path);

    const dashboardRiskIndex = paths.indexOf('/dashboard/risk');
    const riskHighIndex = paths.indexOf('/risk/high');
    const dynamicRiskIndex = paths.indexOf('/:id/risk');

    expect(dashboardRiskIndex).toBeGreaterThanOrEqual(0);
    expect(riskHighIndex).toBeGreaterThanOrEqual(0);
    expect(dynamicRiskIndex).toBeGreaterThanOrEqual(0);
    expect(dashboardRiskIndex).toBeLessThan(dynamicRiskIndex);
    expect(riskHighIndex).toBeLessThan(dynamicRiskIndex);
  });

  test('due-soon obligations route is registered before dynamic obligation route', () => {
    const routes = flatten(contractsRouter).filter((r) => r.methods.includes('get'));
    const paths = routes.map((r) => r.path);

    const obligationsDueSoonIndex = paths.indexOf('/obligations/due-soon');
    const obligationsIdIndex = paths.indexOf('/:id/obligations/:obligationId');

    expect(obligationsDueSoonIndex).toBeGreaterThanOrEqual(0);
    expect(obligationsIdIndex).toBeGreaterThanOrEqual(0);
    expect(obligationsDueSoonIndex).toBeLessThan(obligationsIdIndex);
  });
});