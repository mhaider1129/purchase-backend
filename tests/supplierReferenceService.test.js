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

  it('creates or finds supplier by name only when supplier is optional', async () => {
    findOrCreateSupplierByName.mockResolvedValueOnce({ id: 5, name: 'Global Med' });

    const result = await resolveSupplierReference({}, { supplierName: ' Global Med ', requireSupplier: false });

    expect(result.supplierId).toBe(5);
    expect(result.supplierName).toBe('Global Med');
    expect(findOrCreateSupplierByName).toHaveBeenCalledWith({}, 'Global Med');
  });

  it('throws when supplier_id is required but missing', async () => {
    await expect(resolveSupplierReference({}, { supplierName: 'Global Med', requireSupplier: true })).rejects.toThrow('supplier_id is required');
    expect(findOrCreateSupplierByName).not.toHaveBeenCalled();
  });
});