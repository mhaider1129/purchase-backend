jest.mock('../config/db', () => ({ connect:jest.fn(),query:jest.fn() }));
jest.mock('../utils/emailService', () => ({ sendEmail:jest.fn() }));
const pool = require('../config/db');
const { handleApprovalDecision } = require('../controllers/approvalsController');
const { updateApprovalStatus, approveMaintenanceRequest } = require('../controllers/requests/updateRequestsController');
const { updateItemProcurementStatus, updateItemPurchasedQuantity } = require('../controllers/requestedItemsController');
const { continueApprovalWorkflowAfterLevel } = require('../services/approvalContinuationService');
jest.mock('../utils/ensureRequestedItemPoIssuanceColumn', () => jest.fn().mockResolvedValue());
jest.mock('../utils/ensureRequestedItemFinancialsTable', () => ({ ensureRequestedItemFinancialsTable:jest.fn().mockResolvedValue() }));

const response = () => ({ json:jest.fn(),status:jest.fn().mockReturnThis() });
test.each(['current','legacy','maintenance'])('a stale %s approval cannot restart an SCM-rejected request', async path => {
  const client = { release:jest.fn(),query:jest.fn(async sql => {
    if (sql.includes('FROM approvals')) return { rowCount:1,rows:[{ id:10,request_id:208,approver_id:3,approval_level:1,is_active:true,status:'Pending' }] };
    if (sql.includes('FROM requests')) return { rowCount:1,rows:[{ id:208,status:'Rejected',request_type:'Maintenance',department_id:7,requester_id:2 }] };
    return { rows:[] };
  }) };
  pool.connect.mockResolvedValue(client);
  const req = { params:{ id:'10' },body:{ status:'Approved',decision:'Approved',approval_id:10,request_id:208 },user:{ id:3,role:'CMO',hasPermission:()=>true } };
  const res = response(); const next = jest.fn();
  await ({ current:handleApprovalDecision,legacy:updateApprovalStatus,maintenance:approveMaintenanceRequest })[path](req,res,next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode:409 }));
  expect(client.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  expect(res.json).not.toHaveBeenCalled();
});
test.each(['status','quantity'])('stale item %s writes are blocked after request rejection', async path => {
  const client = { release:jest.fn(),query:jest.fn(async sql => ({ rowCount:1,rows:sql.includes('SELECT ri.*') ? [{ id:363,request_id:208,assigned_to:1,request_status:'Rejected',purchased_quantity:0 }] : [] })) };
  pool.connect.mockResolvedValue(client);
  const next = jest.fn();
  await (path==='status' ? updateItemProcurementStatus : updateItemPurchasedQuantity)({ params:{ item_id:363 },body:{ procurement_status:'purchased',purchased_quantity:1 },user:{ id:1,hasPermission:()=>true } },response(),next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode:409 }));
  expect(client.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
});
test('a deferred ranking continuation cannot activate the next approver after rejection', async () => {
  const client = { query:jest.fn() };
  await expect(continueApprovalWorkflowAfterLevel({ client,request:{ request_status:'Rejected' },approval:{},actorId:3 })).rejects.toMatchObject({ statusCode:409 });
  expect(client.query).not.toHaveBeenCalled();
});
