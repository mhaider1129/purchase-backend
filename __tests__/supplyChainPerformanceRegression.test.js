'use strict';
const fs=require('fs');
const path=require('path');
const {createProcurementPerformanceRepository}=require('../repositories/procurementPerformanceRepository');
const {coverageSummary}=require('../services/procurementPerformance/procurementMetricsService');
const {createNotificationOutboxProcessor}=require('../services/notificationOutboxProcessor');

test('projection repository writer carries governed fields and a precedence guard',async()=>{
  const database={query:jest.fn(async()=>({rows:[{case_status:'AWARDED'}]}))};
  await createProcurementPerformanceRepository(database).updateCaseProjection(7,{case_status:'AWARDED',pending_root_cause:null,timestamp:'commercially_ready_at',occurred_at:'2026-01-01',updated_by:4});
  const [sql,params]=database.query.mock.calls[0];
  expect(sql).toMatch(/pending_root_cause/);expect(sql).toMatch(/array_position/);expect(sql).toMatch(/sourcing_started_at/);expect(params).toEqual([7,'AWARDED',null,'commercially_ready_at','2026-01-01',4]);
});

test('dashboard coverage preserves server decimal semantics for 99 of 100',()=>{
  expect(coverageSummary({total_cases:100,activity_status:'PARTIAL',activity_covered_cases:99,activity_coverage_percent:'99.00'},'activity')).toEqual({coverage:'PARTIAL',covered_cases:99,total_cases:100,coverage_percent:'99.00'});
  expect(coverageSummary({total_cases:10,complexity_status:'PARTIAL',complexity_covered_cases:8,complexity_coverage_percent:'80.00'},'complexity')).toMatchObject({coverage:'PARTIAL',covered_cases:8,total_cases:10,coverage_percent:'80.00'});
});

test('outbox projection failure is recorded and retry inserts evidence once',async()=>{
  const coreEvent={id:31,event_type:'PO_ISSUED',retry_count:0};let attempts=0;let activityCount=0;const updates=[];
  const client={query:jest.fn(async(sql,params=[])=>{
    if(sql.includes('SELECT * FROM notification_outbox'))return{rows:[{...coreEvent,retry_count:attempts}]};
    if(sql.includes('UPDATE notification_outbox'))updates.push({sql,params});
    return{rows:[]};
  }),release:jest.fn()};
  const database={connect:jest.fn(async()=>client)};
  const deliver=jest.fn(async()=>{attempts+=1;if(attempts===1)throw new Error('projection unavailable');activityCount+=1;});
  const processor=createNotificationOutboxProcessor({database,deliver});
  await expect(processor.processOne()).resolves.toMatchObject({status:'failed',retryCount:1});
  expect(coreEvent).toMatchObject({id:31,event_type:'PO_ISSUED'});expect(activityCount).toBe(0);
  await expect(processor.processOne()).resolves.toMatchObject({status:'delivered'});expect(activityCount).toBe(1);
  expect(updates.some(entry=>entry.sql.includes("status='failed'"))).toBe(true);
});

test('manual SQL 010 retains foundation invariants without fabricated history',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../sql/manual/010_supply_chain_performance_foundation.sql'),'utf8');
  expect(sql).toMatch(/activity_coverage[\s\S]*LEGACY_INCOMPLETE/);
  expect(sql).toMatch(/procurement_cases_one_active_item_uq/);
  expect(sql).toMatch(/procurement_case_activities_idempotency_uq/);
  expect(sql).toMatch(/NUMERIC\(20,4\)/);
  expect(sql).toMatch(/010 preflight missing/);
  expect(sql).not.toMatch(/evidence_coverage/);
  expect(sql).not.toMatch(/INSERT INTO public\.procurement_case_complexity_factors/);
});