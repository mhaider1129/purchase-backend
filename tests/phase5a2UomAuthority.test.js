'use strict';
const uom = require('../services/uomConversionService');
const { buildReceiptCommand } = require('../services/goodsReceiptInventoryAdapter');
const { ItemMasterFoundationService } = require('../services/itemMasterFoundationService');
const validator = require('../validators/itemMasterFoundationValidator');
const { createPurchaseOrderFromAwards } = require('../services/purchaseOrderService');
const fs = require('fs');
const path = require('path');
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
    const client = { release: jest.fn(), query: jest.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 9, supplier_id: 1, approved_product_id: 2, supplier_item_code: 'X', purchasing_uom: 'CASE', purchasing_uom_id: 4, conversion_factor: '1', package_size: '1', minimum_order_quantity: '1', order_multiple: '1', unit_price: '1', currency: 'USD', lead_time_days: 1, is_preferred_supplier: false, is_approved_supplier: false }] }).mockResolvedValueOnce({ rowCount: 0, rows: [] }).mockResolvedValue({}) };
    const service = new ItemMasterFoundationService({ connect: jest.fn().mockResolvedValue(client) });
    await expect(service.updateCatalog(9, { approved_product_id: 8 }, 3)).rejects.toMatchObject({ statusCode: 409 });
    expect(client.query.mock.calls.some(([sql]) => sql.includes("p.approval_status='approved'") && sql.includes("g.lifecycle_status='active'"))).toBe(true);
  });
  test('catalog input requires controlled purchasing UOM identity and ignores caller text identity', () => {
    expect(() => validator.catalog({ supplier_id: 1, approved_product_id: 2, supplier_item_code: 'X' })).not.toThrow();
    expect(validator.catalog({ supplier_id: 1, approved_product_id: 2, supplier_item_code: 'X', purchasing_uom_id: 4, purchasing_uom: 'FAKE' }))
      .toMatchObject({ purchasing_uom_id: 4 });
  });
  test('governed award snapshots CASE10 times BOX100 as factor1000 and preserves identities', async () => {
    const award = { id: 8, request_id: 1, request_item_id: 2, supplier_id: 3, approved_product_id: 20, supplier_catalog_item_id: 30, status: 'ACTIVE', awarded_quantity: '2', unit_price: '4', currency: 'USD', source_type: 'QUOTATION' };
    const inserted=[];
    const tx={lockAwards:async()=>[award],getAwardConversion:async()=>({remaining_quantity:'2'}),loadAwardUomSnapshot:async()=>({source_uom_id:4,source_uom:'CASE',base_uom_id:1,base_uom:'EA',generic_base_uom_id:1,inventory_uom_id:1,supplier_conversion_factor:'10',package_quantity:'100'}),nextPurchaseOrderNumber:async()=>({po_number:'PO-1'}),findPurchaseOrderByNumber:async()=>null,insertHeader:async row=>({id:9,...row}),insertLine:async row=>{inserted.push({...row});return row;}};
    const po=await createPurchaseOrderFromAwards({repository:{withTransaction:work=>work(tx)},awardIds:[8],actor:{id:7}});
    expect(po.lines[0]).toMatchObject({approved_product_id:20,supplier_catalog_item_id:30,source_uom:'CASE',base_uom:'EA',conversion_factor:'1000'});
    expect(inserted[0].conversion_factor).toBe('1000');
  });
  test('legacy award and base/inventory mismatch both fail closed', async () => {
    const run=(award,snapshot)=>createPurchaseOrderFromAwards({repository:{withTransaction:work=>work({lockAwards:async()=>[award],getAwardConversion:async()=>({remaining_quantity:'1'}),loadAwardUomSnapshot:async()=>snapshot})},awardIds:[1],actor:{id:7}});
    const base={id:1,request_id:1,request_item_id:2,supplier_id:3,status:'ACTIVE',awarded_quantity:'1',unit_price:'1',currency:'USD',source_type:'QUOTATION'};
    await expect(run(base)).rejects.toMatchObject({code:'AWARD_UOM_IDENTITY_REQUIRED'});
    await expect(run({...base,approved_product_id:20,supplier_catalog_item_id:30},{source_uom_id:4,source_uom:'CASE',base_uom_id:2,base_uom:'KG',generic_base_uom_id:1,inventory_uom_id:2,supplier_conversion_factor:'10',package_quantity:'100'})).rejects.toMatchObject({code:'GENERIC_INVENTORY_UOM_CONVERSION_REQUIRED'});
  });
  test('SQL 009 separates migration blockers from historical reconciliation', () => {
    const sql=fs.readFileSync(path.join(__dirname,'../sql/manual/009_phase5a2_uom_authority.sql'),'utf8');
    expect(sql).toContain('MIGRATION BLOCKERS');
    expect(sql).toContain('HISTORICAL RECONCILIATION COUNTS');
    expect(sql).not.toContain("SELECT 'po_snapshot_missing', COUNT(*) FROM purchase_order_items");
  });
  test('SQL 009 can inspect and upgrade a Phase 4 receipt table without conversion_factor', () => {
    const sql=fs.readFileSync(path.join(__dirname,'../sql/manual/009_phase5a2_uom_authority.sql'),'utf8');
    const begin=sql.indexOf('BEGIN;');
    expect(sql.slice(0,begin)).toContain("to_jsonb(g)->>'conversion_factor'");
    expect(sql.slice(0,begin)).not.toMatch(/goods_receipt_items[^;]*\bconversion_factor\s+IS\s+NULL/i);
    expect(sql.slice(begin)).toContain('ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC;');
    expect(sql.slice(begin)).toContain('goods_receipt_items_positive_conversion');
  });
});