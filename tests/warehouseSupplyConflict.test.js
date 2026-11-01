'use strict';
jest.mock('../config/db', () => ({ query:jest.fn(), connect:jest.fn() }));
jest.mock('../utils/ensureWarehouseAssignments', () => jest.fn());
jest.mock('../utils/ensureWarehouseInventoryTables', () => jest.fn());
jest.mock('../utils/ensureItemRecallsTable', () => jest.fn());
jest.mock('../utils/ensureRequestedItemApprovalColumns', () => jest.fn());
jest.mock('../utils/ensureWarehouseSupplyTables', () => ({ensureWarehouseSupplyTables:jest.fn()}));
const db = require('../config/db');
const {recordSuppliedItems} = require('../controllers/warehouseSupplyController');
const {getWarehouseItems} = require('../controllers/warehouseInventoryController');
const actor={id:7,institute_id:1,warehouse_id:3,permissions:['warehouse.manage-supply'],hasPermission:p=>p==='warehouse.manage-supply'};
function fixture() {
  let state={ supplied:[], movements:[], allocations:[], audit:[], logs:[], status:'Approved', balances:[
    {id:80,warehouse_id:3,stock_item_id:11,batch_id:500,batch_number:'BATCH-A',lot_number:'LOT-A',serial_number:null,expiry_date:'2028-01-01',stock_status:'AVAILABLE',quantity:20,reserved_quantity:2},
    {id:81,warehouse_id:3,stock_item_id:11,batch_id:501,batch_number:'BATCH-B',lot_number:'LOT-B',serial_number:null,expiry_date:'2028-02-01',stock_status:'AVAILABLE',quantity:20,reserved_quantity:0},
  ]};
  let snapshot,seq=100;
  const rows=value=>({rows:value,rowCount:value.length});
  const client={release:jest.fn(),query:jest.fn(async (sql,p=[])=>{
    if(sql==='BEGIN'){snapshot=structuredClone(state);return rows([]);}
    if(sql==='ROLLBACK'){state=snapshot;return rows([]);}
    if(sql==='COMMIT')return rows([]);
    if(sql.includes('FROM requests WHERE id')) return rows([{id:1343,request_type:'Warehouse Supply',status:state.status,department_id:9,supply_warehouse_id:3}]);
    if(sql.includes('FROM warehouse_supply_items') && !sql.includes('LEFT JOIN')) return rows([{id:44,item_name:'Gauze',quantity:30}]);
    if(sql.includes('FROM warehouse_supplied_items') && sql.includes('GROUP BY'))return rows([{item_id:44,total_supplied:state.supplied.reduce((s,i)=>s+i.quantity,0)}]);
    if(sql.includes('FROM stock_items'))return rows([{id:11,name:'Gauze',unit:'Piece'}]);
    if(sql.includes('FROM item_recalls'))return rows(f.recall?[{id:6}]:[]);
    if(sql.includes('FROM warehouse_stock_levels WHERE warehouse_id=$1'))return rows(state.balances.filter(b=>b.warehouse_id===p[0]&&b.stock_item_id===p[1]&&(p[2]==null||b.id===p[2])&&(p[3]==null||b.batch_id===p[3])&&(p[4]==null||b.lot_number===p[4])&&(p[5]==null||b.expiry_date===p[5])&&b.stock_status==='AVAILABLE'&&b.quantity-b.reserved_quantity>0).slice(0,2));
    if(sql.includes('INSERT INTO warehouse_supplied_items')){const row={id:++seq,quantity:p[2]};state.supplied.push(row);return rows([row]);}
    if(sql.includes('FROM warehouses'))return rows([{id:3,institute_id:1,name:'Central'}]);
    if(sql.includes('pg_advisory_xact_lock'))return rows([]);
    if(sql.includes('SELECT id FROM inventory_transactions'))return rows(state.movements.filter(m=>m.idempotency_key===p[0]));
    if(sql.includes('ORDER BY expiry_date ASC NULLS LAST, id FOR UPDATE'))return rows(state.balances.filter(b=>b.warehouse_id===p[0]&&b.stock_item_id===p[1]&&b.stock_status===p[2]&&(p[3]==null||b.batch_number===p[3])&&(p[4]==null||b.lot_number===p[4])&&b.quantity-b.reserved_quantity>0));
    if(sql.includes('FROM warehouse_stock_levels WHERE id ='))return rows(state.balances.filter(b=>b.id===p[0]&&b.warehouse_id===p[1]&&b.stock_item_id===p[2]&&b.stock_status===p[3]));
    if(sql.includes('UPDATE warehouse_stock_levels')){const b=state.balances.find(b=>b.id===p[0]);if(b.quantity-b.reserved_quantity+p[1]<0)return rows([]);b.quantity+=p[1];return rows([{...b}]);}
    if(sql.includes('INSERT INTO inventory_transactions')){const m={id:++seq,idempotency_key:p[22],source_document_line_id:p[18],batch_number:p[11],quantity:p[6],command_fingerprint:p[26]};state.movements.push(m);return rows([m]);}
    if(sql.includes('INSERT INTO inventory_transaction_allocations')){const a={id:++seq,inventory_transaction_id:p[0],warehouse_stock_level_id:p[1],quantity:p[5],batch_number:p[6],lot_number:p[7]};state.allocations.push(a);return rows([a]);}
    if(sql.includes('SUM(quantity)'))return rows([{total_quantity:state.balances.reduce((s,b)=>s+b.quantity,0)}]);
    if(sql.includes('UPDATE stock_items'))return rows([]);
    if(sql.includes('INSERT INTO audit_logs')){if(f.auditFailure)throw Error('Audit unavailable');state.audit.push(p);return rows([{id:++seq}]);}
    if(sql.includes('FROM warehouse_supply_items wsi'))return rows([{id:44,quantity:30,supplied:state.supplied.reduce((s,i)=>s+i.quantity,0)}]);
    if(sql.includes('UPDATE requests SET status')){state.status='Completed';return rows([]);}
    if(sql.includes('SELECT name FROM departments'))return rows([{name:'Ward'}]);
    if(sql.includes('INSERT INTO request_logs')){state.logs.push(p);return rows([]);}
    throw Error(`Unexpected SQL: ${sql}`);
  })};
  const f={client,get state(){return state;}};
  db.connect.mockResolvedValue(client);
  f.save=async (item={},user=actor)=>{
    const res={status:jest.fn().mockReturnThis(),json:jest.fn()},next=jest.fn();
    await recordSuppliedItems({params:{requestId:'1343'},body:{items:[{item_id:44,supplied_quantity:5,warehouse_stock_level_id:80,...item}]},user},res,next);
    return {res,error:next.mock.calls[0]?.[0]};
  };
  return f;
}
beforeEach(()=>{jest.spyOn(console,'error').mockImplementation(()=>{});});
test('selected legacy batch ID resolves to canonical batch number and exact allocation',async()=>{
  const f=fixture();const {error,res}=await f.save({batch_id:500,expected_supplied_quantity:0});
  expect(error).toBeUndefined();expect(res.status).toHaveBeenCalledWith(201);
  expect(f.state.movements[0]).toMatchObject({batch_number:'BATCH-A',quantity:-5,source_document_line_id:String(f.state.supplied[0].id)});
  expect(f.state.allocations[0]).toMatchObject({warehouse_stock_level_id:80,quantity:-5,batch_number:'BATCH-A'});
  expect(f.state.balances.map(b=>b.quantity)).toEqual([15,20]);expect(f.state.audit).toHaveLength(1);
  const queries=f.client.query.mock.calls.map(([sql])=>sql);
  expect(queries.find(sql=>sql.includes('FROM warehouse_stock_levels WHERE warehouse_id=$1'))).not.toContain('FOR UPDATE');
  expect(queries.findIndex(sql=>sql.includes('pg_advisory_xact_lock'))).toBeLessThan(queries.findIndex(sql=>sql.includes('FROM warehouse_stock_levels WHERE id =')));
});
test('equal-quantity installments from different lots post independently',async()=>{
  const f=fixture();expect((await f.save({expected_supplied_quantity:0})).error).toBeUndefined();
  expect((await f.save({warehouse_stock_level_id:81,expected_supplied_quantity:5})).error).toBeUndefined();
  expect(f.state.movements).toHaveLength(2);expect(new Set(f.state.movements.map(m=>m.idempotency_key)).size).toBe(2);
  expect(f.state.balances.map(b=>b.quantity)).toEqual([15,15]);
});
test('equal-quantity installments from the same lot both decrement stock',async()=>{
  const f=fixture();await f.save({expected_supplied_quantity:0});await f.save({expected_supplied_quantity:5});
  expect(f.state.movements).toHaveLength(2);expect(f.state.balances[0].quantity).toBe(10);
});
test('stale save/retry is rejected before another supply record or movement',async()=>{
  const f=fixture();await f.save({expected_supplied_quantity:0});
  expect((await f.save({expected_supplied_quantity:0})).error).toMatchObject({statusCode:409,code:'SUPPLY_QUANTITY_CHANGED'});
  expect(f.state.movements).toHaveLength(1);expect(f.state.supplied).toHaveLength(1);
});
test('legacy batch-only payload resolves a real balance without converting ID to batch number',async()=>{
  const f=fixture();const result=await f.save({warehouse_stock_level_id:undefined,batch_id:500});
  expect(result.error).toBeUndefined();expect(f.state.movements[0].batch_number).toBe('BATCH-A');
});
test.each(['foreign','quarantine','reserved','missing'])('rejects %s selected balance',async kind=>{
  const f=fixture();if(kind==='foreign')f.state.balances[0].warehouse_id=99;
  if(kind==='quarantine')f.state.balances[0].stock_status='QUARANTINE';
  if(kind==='reserved')f.state.balances[0].reserved_quantity=20;
  const {error}=await f.save({warehouse_stock_level_id:kind==='missing'?999:80});
  expect(error).toMatchObject({statusCode:409,code:'SUPPLY_BALANCE_CHANGED'});expect(f.state.supplied).toHaveLength(0);
});
test('does not use another lot when selected available quantity is insufficient',async()=>{
  const f=fixture();const {error}=await f.save({supplied_quantity:19});
  expect(error).toMatchObject({statusCode:409,code:'INSUFFICIENT_STOCK'});expect(f.state.supplied).toHaveLength(0);expect(f.state.balances[0].quantity).toBe(20);
});
test('ambiguous legacy batch fails with actionable selection conflict',async()=>{
  const f=fixture();f.state.balances[1].batch_id=500;
  expect((await f.save({warehouse_stock_level_id:undefined,batch_id:500})).error).toMatchObject({statusCode:409,code:'SUPPLY_BALANCE_CHANGED'});
});
test('audit failure rolls back supply, stock and movement together',async()=>{
  const f=fixture();f.auditFailure=true;expect((await f.save()).error.statusCode).toBe(500);
  expect(f.state.supplied).toHaveLength(0);expect(f.state.movements).toHaveLength(0);expect(f.state.balances[0].quantity).toBe(20);
});
test('recall block and approval/warehouse/permission checks remain enforced',async()=>{
  const f=fixture();f.recall=true;expect((await f.save()).error.message).toMatch(/recall/);
  f.recall=false;f.state.status='Submitted';expect((await f.save()).error.statusCode).toBe(400);
  f.state.status='Approved';expect((await f.save({}, {...actor,warehouse_id:4})).error.statusCode).toBe(403);
  expect((await f.save({}, {...actor,hasPermission:()=>false})).error.statusCode).toBe(403);expect(f.state.movements).toHaveLength(0);
});
test('warehouse item lookup exposes canonical balance identity and unreserved availability',async()=>{
  db.query.mockResolvedValue({rows:[]});const res={json:jest.fn()};await getWarehouseItems({params:{warehouseId:'3'}},res,jest.fn());
  const sql=db.query.mock.calls.at(-1)[0];expect(sql).toContain('wsl.id AS warehouse_stock_level_id');expect(sql).toContain('wsl.batch_number');expect(sql).toContain('wsl.reserved_quantity');expect(sql).toContain('AS available_quantity');
});

test('unselected batch retains canonical FEFO allocation across available lots',async()=>{
  const f=fixture();const result=await f.save({warehouse_stock_level_id:undefined,supplied_quantity:20});
  expect(result.error).toBeUndefined();expect(f.state.allocations.map(a=>[a.warehouse_stock_level_id,a.quantity])).toEqual([[80,-18],[81,-2]]);
  expect(f.state.balances.map(b=>b.quantity)).toEqual([2,18]);
});
