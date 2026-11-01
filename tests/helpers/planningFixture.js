function fixture(pool, lookup) {
  const clone = value => structuredClone(value);
  const all = ['planning.view','planning.manage','replenishment.manage','planning.cross-department','planning.cross-warehouse'];
  let state = {
    users: {
      9: { id:9,role:'SCM',department_id:2,warehouse_id:10,institute_id:7,is_active:true,permissions:all },
      10: { id:10,role:'Viewer',department_id:2,warehouse_id:10,institute_id:7,is_active:true,permissions:['planning.view'] },
      11: { id:11,role:'Requester',department_id:2,institute_id:7,is_active:true,permissions:[] },
      12: { id:12,role:'Planner',department_id:3,institute_id:7,is_active:true,permissions:['planning.manage'] },
      13: { id:13,role:'Planner',department_id:2,warehouse_id:10,institute_id:7,is_active:true,permissions:['planning.manage','replenishment.manage'] },
    },
    departments: [{id:2,institute_id:7},{id:3,institute_id:7},{id:4,institute_id:8}],
    warehouses: [{id:10,department_id:2,institute_id:7,is_active:true},{id:11,department_id:3,institute_id:7,is_active:true},{id:20,department_id:4,institute_id:8,is_active:true},{id:30,department_id:null,institute_id:null,is_active:true}],
    stocks: [{id:3,institute_id:7},{id:4,institute_id:8},{id:5,institute_id:null}],
    balances: [{id:1,warehouse_id:10,stock_item_id:3,quantity:2},{id:2,warehouse_id:10,stock_item_id:5,quantity:1}],
    plans: [{id:5,department_id:2,plan_year:2026,file_name:'Plan',file_path:'plans/own.pdf'},{id:6,department_id:4,plan_year:2026,file_name:'Foreign',file_path:'plans/foreign.pdf'},{id:7,department_id:3,plan_year:2026}],
    items: [{id:51,plan_id:5,stock_item_id:3,item_name:'Item',planned_quantity:10}],
    requests: [{id:31,department_id:2,institute_id:7,created_at:'2026-10-01'},{id:32,department_id:4,institute_id:8,created_at:'2026-10-01'},{id:33,department_id:3,institute_id:7,created_at:'2026-10-01'}],
    requested: [{id:41,request_id:31,stock_item_id:3,quantity:5,total_cost:10},{id:42,request_id:32,quantity:3},{id:43,request_id:33,quantity:4}],
    movements: [{id:81,warehouse_id:10,to_department_id:2,stock_item_id:3,direction:'out',quantity:4},{id:82,warehouse_id:20,to_department_id:4,stock_item_id:4,direction:'out',quantity:8},{id:83,warehouse_id:11,to_department_id:2,stock_item_id:3,direction:'out',quantity:7}],
    departmentMovements: [{id:91,department_id:2,source_warehouse_id:10,stock_item_id:3,direction:'out',quantity:2}],
    settings: [{id:61,institute_id:7,warehouse_id:null,forecast_horizon_months:6}],
    policies: [{id:71,warehouse_id:10,stock_item_id:3,reorder_point:10,safety_stock:2,lead_time_days:1,lot_size:0,is_active:true}],
    links: [], consumptions: [], tasks: [], audits: [], sequence:100, schema:true,
  };
  let queue = Promise.resolve(), failAudit = false;
  const statements = [];
  const rows = values => ({rows:clone(values),rowCount:values.length});
  lookup.mockImplementation(async userId => ({ found:!!state.users[userId],permissions:state.users[userId]?.permissions || [],dataScopes:state.users[userId]?.data_scopes || {} }));
  const query = async (raw,p=[]) => {
    const sql=raw.replace(/\s+/g,' ').trim(); statements.push({sql,p:clone(p)});
    if (sql.startsWith('SELECT id,role,') || sql.startsWith('SELECT u.id, u.name')) return rows(state.users[p[0]]?[state.users[p[0]]]:[]);
    if (/^(CREATE|ALTER)\b/.test(sql)) return rows([]); // mocked legacy initializer only
    if (sql.includes('AS planning_scope_available')) return rows([{planning_scope_available:state.schema}]);
    if (sql.includes('pg_advisory_xact_lock')) return rows([]);
    if (sql.startsWith('SELECT id,institute_id FROM departments')) return rows(state.departments.filter(d=>d.id===Number(p[0])));
    if (sql.startsWith('SELECT w.*,d.institute_id')) return rows(state.warehouses.filter(w=>w.id===Number(p[0])).map(w=>({...w,department_institute_id:state.departments.find(d=>d.id===w.department_id)?.institute_id})));
    if (sql.startsWith('SELECT p.*,d.institute_id')) return rows(state.plans.filter(x=>x.id===Number(p[0])).map(x=>({...x,institute_id:state.departments.find(d=>d.id===x.department_id)?.institute_id})));
    if (sql.startsWith('SELECT p.* FROM procurement_plans')) return rows(state.plans.filter(x=>state.departments.find(d=>d.id===x.department_id)?.institute_id===p[0]&&(p[1]||p[2].includes(x.department_id))&&(!p[3]||x.department_id===Number(p[3]))&&(!p[4]||x.plan_year===Number(p[4]))));
    if (sql.startsWith('SELECT * FROM stock_items')) return rows(state.stocks.filter(x=>x.id===Number(p[0])));
    if (sql.startsWith('SELECT id FROM warehouse_stock_levels')) return rows(state.balances.filter(x=>x.warehouse_id===Number(p[0])&&x.stock_item_id===Number(p[1])));
    if (sql.startsWith('SELECT id FROM department_stock_levels')) return rows([]);
    if (sql.startsWith('SELECT ri.*,r.institute_id')) return rows(state.requested.filter(x=>x.id===Number(p[0])).map(x=>({...x,...{institute_id:state.requests.find(r=>r.id===x.request_id).institute_id,department_id:state.requests.find(r=>r.id===x.request_id).department_id,request_warehouse_id:state.requests.find(r=>r.id===x.request_id).warehouse_id}})));
    if (sql.startsWith('SELECT department_id,created_at FROM requests')) return rows(state.requests.filter(x=>x.id===Number(p[0])&&x.institute_id===p[1]));
    if (sql.startsWith('SELECT * FROM procurement_plans WHERE department_id')) return rows(state.plans.filter(x=>x.department_id===Number(p[0])&&x.plan_year===Number(p[1])));
    if (sql.startsWith('SELECT * FROM procurement_plan_items')) return rows(state.items.filter(x=>sql.includes('WHERE id=') ? x.id===Number(p[0])&&x.plan_id===Number(p[1]) : x.plan_id===Number(p[0])));
    if (sql.startsWith('SELECT l.* FROM procurement_plan_item_requests')) return rows(state.links.filter(l=>state.items.find(i=>i.id===l.plan_item_id)?.plan_id===Number(p[0])));
    if (sql.startsWith('SELECT l.* FROM procurement_plan_item_consumptions')) return rows(state.consumptions.filter(l=>state.items.find(i=>i.id===l.plan_item_id)?.plan_id===Number(p[0])));
    if (sql.startsWith('SELECT m.*,m.to_department_id')) return rows(state.movements.filter(x=>x.id===Number(p[0])).map(x=>({...x,department_id:x.to_department_id})));
    if (sql.startsWith('SELECT m.*,l.department_id')) return rows(state.departmentMovements.filter(x=>x.id===Number(p[0])));
    if (sql.startsWith('SELECT * FROM planning_settings')) return rows(state.settings.filter(x=>x.institute_id===p[0]&&(x.warehouse_id??null)===(p[1]==null?null:Number(p[1]))));
    if (sql.startsWith('INSERT INTO planning_settings')) {
      const keys=['institute_id','warehouse_id','forecast_horizon_months','forecast_window_size','safety_lead_time_days','safety_review_period_days','demand_history_days','demand_history_months','safety_history_days','mrp_horizon_days','mrp_bucket_days','updated_by'];
      let row=state.settings.find(x=>x.institute_id===p[0]&&(x.warehouse_id??null)===(p[1]??null));
      if(!row){row={id:state.sequence++};state.settings.push(row);} keys.forEach((k,i)=>row[k]=p[i]); return rows([row]);
    }
    if (sql.startsWith('SELECT * FROM warehouse_replenishment_policies')) return rows(state.policies.filter(x=>x.warehouse_id===Number(p[0])&&x.stock_item_id===Number(p[1])));
    if (sql.startsWith('INSERT INTO warehouse_replenishment_policies')) {
      let row=state.policies.find(x=>x.warehouse_id===Number(p[0])&&x.stock_item_id===Number(p[1]));
      if(!row){row={id:state.sequence++};state.policies.push(row);} ['warehouse_id','stock_item_id','reorder_point','safety_stock','lead_time_days','review_period_days','lot_size','is_active','updated_by'].forEach((k,i)=>row[k]=p[i]); return rows([row]);
    }
    if (sql.startsWith('SELECT p.*,(SELECT COALESCE(SUM(s.quantity)')) return rows(state.policies.filter(x=>x.warehouse_id===Number(p[0])&&x.is_active).map(x=>({...x,current_quantity:state.balances.filter(b=>b.warehouse_id===x.warehouse_id&&b.stock_item_id===x.stock_item_id).reduce((n,b)=>n+b.quantity,0)})));
    if (sql.startsWith('SELECT * FROM warehouse_replenishment_tasks')) return rows(state.tasks.filter(x=>x.warehouse_id===Number(p[0])&&x.stock_item_id===Number(p[1])&&['open','planned','ordered'].includes(x.status)).slice(0,1));
    if (sql.startsWith('INSERT INTO warehouse_replenishment_tasks')) {const row={id:state.sequence++,status:'open'}; ['warehouse_id','stock_item_id','current_quantity','reorder_point','safety_stock','suggested_quantity','due_date','created_by'].forEach((k,i)=>row[k]=p[i]);state.tasks.push(row);return rows([row]);}
    if (sql.startsWith('INSERT INTO procurement_plans')) {const row={id:state.sequence++,department_id:p[0],plan_year:p[1],file_name:p[2],file_path:p[3]};state.plans.push(row);return rows([row]);}
    if (sql.startsWith('INSERT INTO procurement_plan_items')) {const row={id:state.sequence++,plan_id:p[0],stock_item_id:p[1],item_name:p[2],planned_quantity:p[5]};state.items.push(row);return rows([row]);}
    if (sql.startsWith('SELECT * FROM procurement_plan_item_requests')) return rows(state.links.filter(x=>x.plan_item_id===p[0]&&x.requested_item_id===p[1]));
    if (sql.startsWith('INSERT INTO procurement_plan_item_requests')) {let row=state.links.find(x=>x.plan_item_id===p[0]&&x.requested_item_id===p[2]);if(!row){row={id:state.sequence++};state.links.push(row);}['plan_item_id','request_id','requested_item_id','quantity','unit_cost','total_cost'].forEach((k,i)=>row[k]=p[i]);return rows([row]);}
    if (sql.startsWith('SELECT * FROM procurement_plan_item_consumptions')) return rows(state.consumptions.filter(x=>x.plan_item_id===p[0]&&x[sql.includes('AND warehouse_stock_movement_id')?'warehouse_stock_movement_id':'department_stock_movement_id']===Number(p[1])));
    if (sql.startsWith('INSERT INTO procurement_plan_item_consumptions')) {const column=sql.includes('(plan_item_id,warehouse_stock_movement_id')?'warehouse_stock_movement_id':'department_stock_movement_id';const row={id:state.sequence++,plan_item_id:p[0],[column]:Number(p[1]),quantity:p[2]};state.consumptions.push(row);return rows([row]);}
    if (sql.startsWith('UPDATE procurement_plan_item_consumptions')) {const row=state.consumptions.find(x=>x.id===p[1]);row.quantity=p[0];return rows([row]);}
    if (sql.startsWith('INSERT INTO audit_logs')) {if(failAudit)throw Error('Audit unavailable');const row={id:state.audits.length+1,action:p[0],actor_id:p[1],entity_type:p[2],entity_id:p[3],...JSON.parse(p[5])};state.audits.push(row);return rows([row]);}
    if (sql.startsWith('SELECT TO_CHAR(r.created_at') || sql.startsWith('SELECT r.created_at::date')) return rows([]);
    if (sql.startsWith('SELECT ppi.*') || sql.startsWith('WITH plan_items AS')) return rows([]);
    throw Error(`Unhandled planning fixture SQL: ${sql}`);
  };
  pool.query.mockImplementation(query);
  pool.connect.mockImplementation(async()=>{
    let before,unlock;
    return {release(){},query:async(sql,p)=>{
      if(sql==='BEGIN'){const prior=queue;queue=new Promise(r=>{unlock=r;});await prior;before=clone(state);return rows([]);}
      if(sql==='COMMIT'){unlock?.();return rows([]);}
      if(sql==='ROLLBACK'){state=before;unlock?.();return rows([]);}
      return query(sql,p);
    }};
  });
  return {get state(){return state;},statements,set failAudit(value){failAudit=value;},db:pool,lookup};
}
module.exports=fixture;
