'use strict';
const { submitSupplierInvoice, fingerprintInvoice, decideMatchOverride } = require('../services/supplierInvoiceService');
const { matchInvoice } = require('../services/invoiceMatchingService');
const audit={writeAuditEvent:jest.fn()},outbox={enqueueNotification:jest.fn()};
const base=()=>({purchaseOrderId:10,supplierId:2,invoiceNumber:' Inv-1 ',invoiceDate:'2026-08-12',currency:'USD',idempotencyKey:'key-1',actor:{id:7},lines:[{purchase_order_item_id:11,quantity:'10.0000',unit_price:'3.3333'}],auditService:audit,outbox});
const repository=({retry=null,duplicate=null,po={id:10,request_id:5,supplier_id:2,status:'PO_ISSUED'}}={})=>{const saved=[];const tx={client:{},lockInvoiceOperation:jest.fn(),findInvoiceByIdempotency:jest.fn(async()=>retry),loadInvoiceWithLines:jest.fn(async id=>saved.find(x=>x.id===id)||{...retry,lines:[]}),lockSupplierInvoiceIdentity:jest.fn(),findSupplierInvoiceByNormalizedNumber:jest.fn(async()=>duplicate),lockPurchaseOrder:jest.fn(async()=>po),loadPurchaseOrderLines:jest.fn(async()=>[{id:11,requested_item_id:4,quantity:'10',unit_price:'3.3333',line_type:'INVENTORY'}]),insertSupplierInvoice:jest.fn(async x=>{const v={id:20,...x,lines:[]};saved.push(v);return v}),insertSupplierInvoiceLine:jest.fn(async x=>(saved[0].lines.push(x),x))};return{withTransaction:fn=>fn(tx),tx};};
describe('submission',()=>{
 beforeEach(()=>jest.clearAllMocks());
 test('idempotency is mandatory',async()=>expect(submitSupplierInvoice({...base(),repository:repository(),idempotencyKey:''})).rejects.toMatchObject({code:'IDEMPOTENCY_KEY_REQUIRED'}));
 test('wrong supplier rejected',async()=>expect(submitSupplierInvoice({...base(),repository:repository({po:{id:10,supplier_id:3,status:'PO_ISSUED'}})})).rejects.toMatchObject({code:'SUPPLIER_MISMATCH'}));
 test('draft PO rejected',async()=>expect(submitSupplierInvoice({...base(),repository:repository({po:{id:10,supplier_id:2,status:'PO_DRAFT'}})})).rejects.toMatchObject({code:'PO_NOT_INVOICEABLE'}));
 test('exact backend total ignores caller total',async()=>{const r=repository();const x=await submitSupplierInvoice({...base(),repository:r,total_amount:'999'});expect(x.invoice.total_amount).toBe('33.33');});
 test('same payload retry is idempotent and unaudited',async()=>{const b=base();const r=await submitSupplierInvoice({...b,repository:repository({retry:{id:20,payload_fingerprint:fingerprintInvoice(b)}})});expect(r.idempotent).toBe(true);expect(audit.writeAuditEvent).not.toHaveBeenCalled()});
 test('changed payload retry conflicts',async()=>expect(submitSupplierInvoice({...base(),repository:repository({retry:{id:20,payload_fingerprint:'bad'}})})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'}));
 test('duplicate supplier identity rejected',async()=>expect(submitSupplierInvoice({...base(),repository:repository({duplicate:{id:9}})})).rejects.toMatchObject({code:'DUPLICATE_INVOICE'}));
});
const match=(qty,received,prior='0',type='INVENTORY',price='10')=>matchInvoice({invoice:{supplier_id:2,currency:'USD',lines:[{purchase_order_item_id:11,quantity:qty,unit_price:price}]},purchaseOrder:{supplier_id:2,currency:'USD',lines:[{id:11,quantity:'100',unit_price:'10',line_type:type}]},acceptedReceipts:[{purchase_order_item_id:11,accepted_quantity:received}],priorQuantities:[{purchase_order_item_id:11,invoiced_quantity:prior}],priorValues:[{purchase_order_item_id:11,invoiced_value:String(Number(prior)*10)}]});
describe('matching',()=>{
 test.each([['100','100'],['90','90']])('accepted %s invoice %s verifies',(q,r)=>expect(match(q,r).status).toBe('MATCH_VERIFIED'));
 test('accepted 90 invoice 100 varies',()=>expect(match('100','90').variances).toEqual(expect.arrayContaining([expect.objectContaining({code:'QUANTITY_VARIANCE'})])));
 test('prior 70 plus current 70 fails quantity and value',()=>expect(match('70','100','70').variances.map(x=>x.code)).toEqual(expect.arrayContaining(['OVER_INVOICED','QUANTITY_VARIANCE','VALUE_VARIANCE'])));
 test('prior 70 plus current 30 verifies',()=>expect(match('30','100','70').status).toBe('MATCH_VERIFIED'));
 test('price variance structured',()=>expect(match('10','10','0','INVENTORY','11').variances).toEqual(expect.arrayContaining([expect.objectContaining({code:'PRICE_VARIANCE',expected:'10',actual:'11'})])));
 test('missing receipt explicit',()=>expect(match('1','0').variances.map(x=>x.code)).toContain('MISSING_RECEIPT'));
 test('service is governed two-way without receipt',()=>expect(match('100','0','0','SERVICE')).toMatchObject({policy:'TWO_WAY',status:'MATCH_VERIFIED'}));
});
test('override reason required',async()=>expect(decideMatchOverride({repository:repository(),matchResultId:1,decision:'APPROVED',reason:'',actor:{id:1}})).rejects.toMatchObject({code:'OVERRIDE_REASON_REQUIRED'}));