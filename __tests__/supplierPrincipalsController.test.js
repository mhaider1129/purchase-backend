jest.mock('../config/db', () => ({ query: jest.fn() }));
jest.mock('../controllers/suppliersController', () => ({
  getSupplierById: jest.fn(),
}));

const pool = require('../config/db');
const { getSupplierById } = require('../controllers/suppliersController');
const {
  createSupplierPrincipal,
  decoratePrincipal,
  listSupplierPrincipals,
  updateSupplierClassification,
  verifySupplierPrincipal,
} = require('../controllers/supplierPrincipalsController');
const { checkSupplierAuthorizationForCategory } = require('../services/supplierAuthorizationService');

const makeReq = ({ params = {}, body = {}, user = {} } = {}) => ({
  params,
  body,
  user: {
    id: 7,
    role: 'SCM',
    hasPermission: jest.fn(() => true),
    hasAnyPermission: jest.fn(() => true),
    ...user,
  },
});

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
};

const expectNextError = async (handler, req) => {
  const res = makeRes();
  const next = jest.fn();
  await handler(req, res, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: expect.any(Number) }));
  return next.mock.calls[0][0];
};

describe('supplier principal and classification controllers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSupplierById.mockResolvedValue({ id: 1, name: 'Acme Medical' });
  });

  test('updates supplier classification', async () => {
    const updated = {
      id: 1,
      name: 'Acme Medical',
      supplier_type: 'Authorized Distributor',
      is_authorized_distributor: true,
      regulatory_risk_level: 'high',
    };
    pool.query.mockResolvedValueOnce({ rows: [updated] });

    const req = makeReq({
      params: { id: '1' },
      body: {
        supplier_type: 'Authorized Distributor',
        is_authorized_distributor: true,
        regulatory_risk_level: 'high',
        supplier_category: 'Implants',
        notes: 'Official regional channel',
      },
    });
    const res = makeRes();
    const next = jest.fn();

    await updateSupplierClassification(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE suppliers'), expect.arrayContaining(['Authorized Distributor', true, 'high', 'Implants', 'Official regional channel', 1]));
    expect(res.json).toHaveBeenCalledWith(updated);
  });

  test('creates supplier principal', async () => {
    const principal = {
      id: 11,
      supplier_id: 1,
      principal_name: 'MedTech GmbH',
      relationship_type: 'Authorized Distributor',
      authorization_status: 'Pending Verification',
      authorization_start_date: '2026-01-01',
      authorization_expiry_date: '2026-12-31',
      is_active: true,
    };
    pool.query.mockResolvedValueOnce({ rows: [principal] });

    const req = makeReq({
      params: { id: '1' },
      body: {
        principal_name: 'MedTech GmbH',
        relationship_type: 'Authorized Distributor',
        authorization_start_date: '2026-01-01',
        authorization_expiry_date: '2026-12-31',
        authorized_categories: ['surgical'],
      },
    });
    const res = makeRes();
    const next = jest.fn();

    await createSupplierPrincipal(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO supplier_principals'), expect.arrayContaining([1, 'MedTech GmbH', null, 'Authorized Distributor']));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 11, expiry_status: 'Active' }));
  });

  test('rejects invalid relationship_type', async () => {
    const error = await expectNextError(
      createSupplierPrincipal,
      makeReq({ params: { id: '1' }, body: { principal_name: 'Bad Principal', relationship_type: 'Broker' } })
    );

    expect(error.statusCode).toBe(400);
    expect(error.message).toMatch(/relationship_type/);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('verifies principal', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 11,
        supplier_id: 1,
        principal_name: 'MedTech GmbH',
        relationship_type: 'Authorized Distributor',
        authorization_status: 'Verified',
        verified_by: 7,
        verified_at: '2026-06-08T12:00:00Z',
      }],
    });

    const req = makeReq({ params: { id: '1', principalId: '11' } });
    const res = makeRes();
    const next = jest.fn();

    await verifySupplierPrincipal(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("authorization_status = 'Verified'"), [7, null, 1, 11]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ authorization_status: 'Verified', verified_by: 7 }));
  });

  test('detects expired authorization when fetching principals', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 11,
        supplier_id: 1,
        principal_name: 'Expired Principal',
        relationship_type: 'Authorized Distributor',
        authorization_status: 'Verified',
        authorization_expiry_date: '2020-01-01',
        is_active: true,
      }],
    });

    const req = makeReq({ params: { id: '1' } });
    const res = makeRes();
    const next = jest.fn();

    await listSupplierPrincipals(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({ is_expired: true, expiry_status: 'Expired' }),
    ]);
    expect(decoratePrincipal({ authorization_expiry_date: '2020-01-01' })).toEqual(expect.objectContaining({ is_expired: true }));
  });

  test('checks authorization eligibility helper', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    await expect(checkSupplierAuthorizationForCategory(1, 'Surgical')).resolves.toBe(true);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM supplier_principals'), [1, 'surgical']);
  });
});