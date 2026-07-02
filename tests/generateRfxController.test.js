jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

jest.mock('../utils/ensureRequestedItemApprovalColumns', () => jest.fn().mockResolvedValue());

jest.mock('pdfkit', () => jest.fn().mockImplementation(() => ({
  pipe: jest.fn(),
  fontSize: jest.fn().mockReturnThis(),
  text: jest.fn().mockReturnThis(),
  moveDown: jest.fn().mockReturnThis(),
  end: jest.fn(),
})));

const pool = require('../config/db');
const PDFDocument = require('pdfkit');
const { generateRfx } = require('../controllers/requests/generateRfxController');

const buildRequest = (overrides = {}) => ({
  params: { id: '252' },
  query: { type: 'rfq' },
  user: { role: 'ProcurementSpecialist' },
  ...overrides,
});

const buildResponse = () => ({
  setHeader: jest.fn(),
});

describe('generateRfxController.generateRfx', () => {
  beforeEach(() => {
    pool.query.mockReset();
    PDFDocument.mockClear();
  });

  it('queries only existing requested_items description source columns when generating an RFQ', async () => {
    pool.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: 252,
          department_name: 'Procurement',
          requester_name: 'Temporary Requester',
          justification: 'Needed for operations',
          project_name: null,
        }],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ item_name: 'Gloves', quantity: 10, unit: 'box', description: 'Nitrile' }],
      });

    const res = buildResponse();
    const next = jest.fn();

    await generateRfx(buildRequest(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(pool.query.mock.calls[1][0]).toContain('COALESCE(NULLIF(TRIM(specs)');
    expect(pool.query.mock.calls[1][0]).toContain('NULL::text AS unit');
    expect(pool.query.mock.calls[1][0]).not.toContain('SELECT item_name, quantity, unit, description');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
  });
});