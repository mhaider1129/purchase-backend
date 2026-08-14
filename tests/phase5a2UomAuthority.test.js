'use strict';
const uom = require('../services/uomConversionService');
const { buildReceiptCommand } = require('../services/goodsReceiptInventoryAdapter');
const { ItemMasterFoundationService } = require('../services/itemMasterFoundationService');
describe('Phase 5A.2 UOM authority', () => {
  test('product and supplier decimals calculate an exact base quantity', () => {
    expect(uom.calculateBaseQuantity({ sourceQuantity: '0.1', supplierConversionFactor: '0.2', productPackageQuantity: '0.3' })).toBe('0.006');
    expect(uom.validateProductPackaging({ packageQuantity: '100.000001', productUom: 'BOX' })).toBe(true);
    expect(uom.validateSupplierPackaging({ conversionFactor: '10.000001', purchasingUom: 'CASE' })).toBe(true);
  });
  test('universal conversion rejects item-specific BOX packaging', () => {
    expect(() => uom.assertUniversalConversion({ fromUom: 'BOX', toUom: 'EA' })).toThrow(/packaging/);
    expect(uom.assertUniversalConversion({ fromUom: 'L', toUom: 'mL' })).toBe(true);
  });
  test('receipt source quantity is converted to canonical ledger UOM', () => {
    const command = buildReceiptCommand({ id: 1, receipt_number: 'GR-1' }, { id: 2, stock_item_id: 3, accepted_quantity: '2', source_uom: 'CASE', base_uom: 'EA', conversion_factor: '1000' }, { instituteId: 4, warehouseId: 5, actor: { id: 6 } });
    expect(command).toMatchObject({ quantity: '2000', sourceQuantity: '2', sourceUom: 'CASE', baseUom: 'EA', conversionFactor: '1000' });
  });
  test('referenceData excludes inactive UOMs', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await new ItemMasterFoundationService(db).referenceData();
    expect(db.query.mock.calls[1][0]).toMatch(/item_uom WHERE is_active=TRUE/);
  });
  test('catalog update revalidates active approved Product and Generic Item', async () => {
    const client = { release: jest.fn(), query: jest.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 9, supplier_id: 1, approved_product_id: 2, supplier_item_code: 'X', purchasing_uom: 'CASE', conversion_factor: '1', package_size: '1', minimum_order_quantity: '1', order_multiple: '1', unit_price: '1', currency: 'USD', lead_time_days: 1, is_preferred_supplier: false, is_approved_supplier: false }] }).mockResolvedValueOnce({ rowCount: 0, rows: [] }).mockResolvedValue({}) };
    const service = new ItemMasterFoundationService({ connect: jest.fn().mockResolvedValue(client) });
    await expect(service.updateCatalog(9, { approved_product_id: 8 }, 3)).rejects.toMatchObject({ statusCode: 409 });
    expect(client.query.mock.calls.some(([sql]) => sql.includes("p.approval_status='approved'") && sql.includes("g.lifecycle_status='active'"))).toBe(true);
  });
});