jest.mock('../controllers/suppliersController', () => ({
  getSupplierById: jest.fn(),
  findOrCreateSupplierByName: jest.fn(),
}));

const { getSupplierById, findOrCreateSupplierByName } = require('../controllers/suppliersController');
const { resolveSupplierReference } = require('../services/supplierReferenceService');

describe('supplierReferenceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves supplier by id when provided', async () => {
    getSupplierById.mockResolvedValueOnce({ id: 44, name: 'Acme' });

    const result = await resolveSupplierReference({}, { supplierId: 44, requireSupplier: true });

    expect(result).toEqual({ supplierId: 44, supplierName: 'Acme', supplier: { id: 44, name: 'Acme' } });
    expect(getSupplierById).toHaveBeenCalledWith({}, 44);
    expect(findOrCreateSupplierByName).not.toHaveBeenCalled();
  });

  it('creates or finds supplier by name when id is not provided', async () => {
    findOrCreateSupplierByName.mockResolvedValueOnce({ id: 5, name: 'Global Med' });

    const result = await resolveSupplierReference({}, { supplierName: ' Global Med ', requireSupplier: true });

    expect(result.supplierId).toBe(5);
    expect(result.supplierName).toBe('Global Med');
    expect(findOrCreateSupplierByName).toHaveBeenCalledWith({}, 'Global Med');
  });

  it('throws when supplier is required but missing', async () => {
    await expect(resolveSupplierReference({}, { requireSupplier: true })).rejects.toThrow('supplier is required');
  });
});