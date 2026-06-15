jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

const pool = require('../config/db');

const { createSupplier, updateSupplier } = require('../controllers/suppliersController');

const makeRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

const supplierRow = {
  id: 7,
  name: 'Acme Medical',
  contact_email: null,
  contact_phone: null,
  supplier_type: 'Local Trader',
  is_manufacturer: false,
  is_authorized_agent: false,
  is_authorized_distributor: false,
  is_sub_distributor: false,
  is_service_provider: false,
  is_contractor: false,
  regulatory_risk_level: 'medium',
  supplier_category: null,
  notes: null,
  tax_number: null,
  bank_info: null,
  currency: null,
  payment_terms: null,
  lead_time_days: null,
  credit_limit: null,
  status: null,
  country: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('suppliersController', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it('migrates legacy bank_info columns to jsonb before saving supplier details', async () => {
    const savedSupplier = {
      ...supplierRow,
      contact_email: 'buyer@example.com',
      bank_info: { iban: 'SA123' },
    };

    pool.query.mockImplementation((sql) => {
      if (/information_schema\.columns/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ data_type: 'text', udt_name: 'text' }] });
      }

      if (/SELECT .*FROM suppliers\s+WHERE LOWER\(name\)/s.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [supplierRow] });
      }

      if (/UPDATE suppliers/s.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [savedSupplier] });
      }

      return Promise.resolve({ rowCount: 0, rows: [] });
    });

    const req = {
      user: { hasPermission: jest.fn().mockReturnValue(true) },
      body: {
        name: 'Acme Medical',
        contact_email: 'buyer@example.com',
        bank_info: { iban: 'SA123' },
      },
    };
    const res = makeRes();
    const next = jest.fn();

    await createSupplier(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ALTER COLUMN bank_info TYPE JSONB'));
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ALTER COLUMN contact_email DROP NOT NULL'));
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('bank_info = COALESCE($5::jsonb, bank_info)'),
      expect.arrayContaining([{ iban: 'SA123' }])
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(savedSupplier);
  });

  it('casts patched bank_info values to jsonb when updating suppliers', async () => {
    const updatedSupplier = { ...supplierRow, bank_info: { account: '123' } };

    pool.query.mockImplementation((sql) => {
      if (/information_schema\.columns/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ data_type: 'jsonb', udt_name: 'jsonb' }] });
      }

      if (/SELECT .*FROM suppliers\s+WHERE id = \$1/s.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [supplierRow] });
      }

      if (/UPDATE suppliers/s.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [updatedSupplier] });
      }

      return Promise.resolve({ rowCount: 0, rows: [] });
    });

    const req = {
      user: { hasPermission: jest.fn().mockReturnValue(true) },
      params: { id: '7' },
      body: { bank_info: { account: '123' } },
    };
    const res = makeRes();
    const next = jest.fn();

    await updateSupplier(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('bank_info = $1::jsonb'),
      [{ account: '123' }, 7]
    );
    expect(res.json).toHaveBeenCalledWith(updatedSupplier);
  });
});