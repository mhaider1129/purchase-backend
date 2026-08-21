'use strict';
const c=require('../services/procurementPerformance/procurementComplexityService');
const a=require('../services/procurementPerformance/procurementActivityService');
const v=require('../services/procurementPerformance/procurementValueService');
const {calculateCycleTimes}=require('../services/procurementPerformance/procurementCycleTimeService');
const {metric,aggregatePending}=require('../services/procurementPerformance/procurementMetricsService');
const {ensureCaseForRequestedItem,instituteScope}=require('../services/procurementPerformance/procurementCaseService');
const facts={supplier_availability:'existing_supplier',market_availability:'local',technical_specialization:'commodity',quotation_difficulty:'routine',importation_logistics:'none',payment_terms:'standard_credit',technical_evaluation:'none',negotiation_effort:'none',documentation_compliance:'standard',urgency:'normal'};
const item={id:7,request_id:3,request_status:'APPROVED',institute_id:2,department_id:4,generic_item_id:null};
const repo=existing=>{const inserted=[];const activities=[];return{inserted,activities,withTransaction:fn=>fn({findActiveByRequestedItem:async()=>existing,insertCase:async x=>(inserted.push(x),{id:9,opened_at:'2026-01-01',...x}),insertActivity:async x=>activities.push(x)})}};

describe('case/activity governance',()=>{
 test('approved item creates one case and retry links existing',async()=>{const r=repo();expect((await ensureCaseForRequestedItem({repository:r,requestedItem:item,actorId:1})).case_status).toBe('ITEM_IDENTITY_RESOLUTION');expect(r.inserted).toHaveLength(1);const old={id:9};expect(await ensureCaseForRequestedItem({repository:repo(old),requestedItem:item,actorId:1})).toBe(old)});
 test.each(['DRAFT','REJECTED'])('%s does not create a case',async status=>expect(await ensureCaseForRequestedItem({repository:repo(),requestedItem:{...item,request_status:status},actorId:1})).toBeNull());
 test.each(['RFQ_CREATED','QUOTATION_RECEIVED','AWARD_CREATED','PO_CREATED'])('%s idempotency evidence deduplicates',type=>{const key=`${type}:1`;expect(new Map([{type,key},{type,key}].map(x=>[x.key,x])).size).toBe(1)});
 test('manual supplier work is a touch but page views are not',()=>{const manual=a.validateManualActivity({activity_type:'SUPPLIER_CONTACTED',procurement_case_id:1,activity_at:'2026-01-01',notes:'Called OEM'});expect(a.summarizeTouches([manual,{activity_type:'SUPPLIER_CONTACTED',source:'PAGE_VIEW'},{activity_type:'PAGE_VIEW'}]).total).toBe(1)});
});
describe('complexity',()=>{
 test('facts are deterministic and versioned',()=>{expect(c.scoreFacts(facts)).toEqual(c.scoreFacts(facts));expect(c.scoreFacts(facts).modelVersion).toBe('PCS-1.0')});
 test.each([[1,'A',1],[20,'A',1],[21,'B',2],[40,'B',2],[41,'C',4],[60,'C',4],[61,'D',7],[80,'D',7],[81,'E',10],[100,'E',10]])('%i => %s / %i PWU',(s,k,p)=>expect(c.classify(s)).toMatchObject({complexityClass:k,workloadUnits:p}));
});
describe('commercial',()=>{
 test('hard savings uses exact decimals and avoidance stays separate',()=>{expect(v.verifiedHardSavings({baselineAmount:'74500.0000',finalAmount:'61000.0000',currency:'USD'}).verifiedValue).toBe('13500.00');expect(v.aggregateByCurrency([{valueType:'HARD_SAVINGS',currency:'USD',verifiedValue:'10.10'},{valueType:'COST_AVOIDANCE',currency:'USD',verifiedValue:'2.20'}])).toEqual({'HARD_SAVINGS:USD':'10.10','COST_AVOIDANCE:USD':'2.20'})});
 test('currencies remain separate and credit days are value weighted',()=>{expect(Object.keys(v.aggregateByCurrency([{valueType:'HARD_SAVINGS',currency:'USD',verifiedValue:'1'},{valueType:'HARD_SAVINGS',currency:'IQD',verifiedValue:'1'}]))).toHaveLength(2);expect(v.weightedCreditDays([{amount:'100',creditDays:30},{amount:'300',creditDays:60}])).toBe(52)});
});
describe('clocks/pending/security/history',()=>{
 const d=calculateCycleTimes({submittedAt:'2026-01-01',fullyApprovedAt:'2026-01-02',sourcingStartedAt:'2026-01-03',commerciallyReadyAt:'2026-01-05',technicalEvaluationRequestedAt:'2026-01-03',technicalEvaluationCompletedAt:'2026-01-04',awardAt:'2026-01-05',poAt:'2026-01-06',shipmentAt:'2026-01-10',deliveryAt:'2026-01-12'});
 test('approval, sourcing, technical, supplier, logistics and total clocks are distinct',()=>expect(d).toEqual({approvalTime:86400000,sourcingTime:172800000,technicalEvaluationTime:86400000,poProcessingTime:86400000,supplierLeadTime:345600000,logisticsLeadTime:172800000,totalEndToEndTime:950400000}));
 test('root causes aggregate and unresolved identity stays separate',()=>expect(aggregatePending([{case_status:'SOURCING',pending_root_cause:'ITEM_IDENTITY_RESOLUTION',opened_at:'2026-01-01'}],new Date('2026-01-03')).ITEM_IDENTITY_RESOLUTION).toEqual({count:1,averageAgeMs:172800000}));
 test('institute authorization does not broaden for a buyer',()=>{const u={institute_id:2,data_scopes:{institute_ids:[2]},hasPermission:()=>true};expect(instituteScope(u,2)).toBe(true);expect(instituteScope(u,3)).toBe(false)});
 test('legacy incomplete is unavailable rather than zero',()=>expect(metric(0,'LEGACY_INCOMPLETE','missing')).toEqual({value:null,coverage:'LEGACY_INCOMPLETE',status:'not_available',reason:'missing'}));
});