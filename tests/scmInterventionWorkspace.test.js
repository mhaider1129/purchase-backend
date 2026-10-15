jest.mock('../config/db', () => ({ query: jest.fn(), connect: jest.fn() }));
const { buildAvailableActions, buildRequestSummary } = require('../controllers/requests/requestWorkspaceController');
const actor = { id:1, role:'SCM', institute_id:7, permissions:['requests.manage'], hasPermission: code => code === 'requests.manage' };
test('SCM can intervene before reaching their own level in their institute', () => {
  const request = { institute_id:7, status:'Submitted' };
  const approvals = [{ approver_id:3, status:'Pending', is_active:true }];
  expect(buildAvailableActions(actor,request,approvals,[])).toContain('scm_reject_request');
  expect(buildAvailableActions(actor,{ ...request,institute_id:8 },approvals,[])).not.toContain('scm_reject_request');
  expect(buildAvailableActions({ ...actor,role:'HOD' },request,approvals,[])).not.toContain('scm_reject_request');
  expect(buildAvailableActions(actor,{ ...request,status:'Approved' },approvals,[])).not.toContain('scm_reject_request');
  expect(buildAvailableActions(actor,request,[{ ...approvals[0],is_superseded:true }],[])).not.toContain('scm_reject_request');
});
test('rejected workspace shows stopped status, keeps history actions and offers no execution actions', () => {
  const request = { id:208, institute_id:7, status:'Rejected' };
  const approvals = [{ status:'Approved' }, { status:'Superseded',is_active:false }];
  const summary = buildRequestSummary(request,approvals,[{ remaining_quantity:1 }]);
  expect(summary).toMatchObject({ approval_status:'Rejected',procurement_status:'Rejected',current_bottleneck:'Request rejected' });
  const actions = buildAvailableActions(actor,request,approvals,[]);
  expect(actions).toEqual(expect.arrayContaining(['add_note','export_pdf']));
  expect(actions).not.toEqual(expect.arrayContaining(['approve_request']));
  expect(actions).not.toContain('register_procurement_entry');
  expect(actions).not.toContain('scm_reject_request');
});
