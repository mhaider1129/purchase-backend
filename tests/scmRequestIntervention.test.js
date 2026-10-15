jest.mock('../config/db', () => ({ connect: jest.fn() }));
const { createScmRequestInterventionService, canIntervene } = require('../services/scmRequestInterventionService');
const actor = { id: 1, role: 'SCM', institute_id: 7, permissions: ['requests.manage'] };
function setup(options = {}) {
  const client = { release: jest.fn(), query: jest.fn(async (sql) => {
    if (sql.startsWith('SELECT * FROM requests')) return { rows: options.missing ? [] : [{ id: 208, institute_id: 7, status: options.status || 'Submitted', requester_id: 2, ...options.request }] };
    if (sql.startsWith('SELECT id FROM request_logs')) return { rows: options.replay ? [{ id: 1 }] : [] };
    if (sql.startsWith('SELECT id,purchased_quantity')) return { rows: [{ id: 363, purchased_quantity: options.purchased || 0 }] };
    if (sql.startsWith('SELECT EXISTS')) return { rows: [{ started: Boolean(options.started) }] };
    if (sql.startsWith('SELECT id,approver_id')) return { rows: options.noApprovals ? [] : [{ id: 10, approver_id: 3, is_active: true, status: 'Pending' }, { id: 11, approver_id: 1, is_active: false, status: 'Pending' }] };
    if (options.failNotifications && sql.includes('INSERT INTO notifications')) throw new Error('Notification failed');
    return { rows: [] };
  }) };
  const database = { connect: jest.fn(async () => client) };
  return { client, database, reject: createScmRequestInterventionService(database) };
}
test.each([{ ...actor, role: 'HOD' }, { ...actor, role: 'ProcurementSpecialist' }, { ...actor, permissions: [] }, { ...actor, institute_id: null }])('denies unauthorized actor before connection: %j', async (user) => {
  const { reject, database } = setup();
  await expect(reject({ requestId: 208, reason: 'Wrong submission', actor: user })).rejects.toMatchObject({ statusCode: 403 });
  expect(database.connect).not.toHaveBeenCalled();
});
test.each(['', ' ', 'x'.repeat(2001), null])('requires a meaningful bounded reason %j', async reason => {
  const { reject, database } = setup();
  await expect(reject({ requestId: 208, reason, actor })).rejects.toMatchObject({ statusCode: 400 });
  expect(database.connect).not.toHaveBeenCalled();
});
test('stops future and parallel approvals, records SCM actor and notifies only current participants', async () => {
  const { reject, client } = setup();
  await expect(reject({ requestId: 208, reason: ' Wrong submission ', actor })).resolves.toMatchObject({ status: 'Rejected', stopped_approval_ids: [10,11] });
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('institute_id=$2 FOR UPDATE'), [208,7]);
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining("status='Superseded'"), [[10,11],1,'SCM intervention: Wrong submission']);
  expect(client.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO notifications')).map(([, params]) => params[0])).toEqual([2,3]);
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_logs'), expect.arrayContaining(['request.scm_early_rejected',1]));
  expect(client.query).toHaveBeenLastCalledWith('COMMIT');
});
test.each([{ status:'Approved' }, { status:'Completed' }, { purchased:1 }, { started:true }, { noApprovals:true }, { request:{ purchase_order_id:8 } }])('blocks requests no longer eligible: %j', async options => {
  const { reject, client } = setup(options);
  await expect(reject({ requestId: 208, reason:'Wrong submission', actor })).rejects.toMatchObject({ statusCode:409 });
  expect(client.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
});
test('cross-institute or unknown requests are not exposed', async () => {
  const { reject } = setup({ missing:true });
  await expect(reject({ requestId:208, reason:'Wrong submission', actor })).rejects.toMatchObject({ statusCode:404 });
  expect(canIntervene(actor,{ institute_id:8, status:'Submitted' })).toBe(false);
});
test('same actor/reason retry is idempotent; ordinary or different rejection cannot be replayed', async () => {
  for (const replay of [true,false]) {
    const { reject, client } = setup({ status:'Rejected', replay });
    const result = reject({ requestId:208, reason:'Wrong submission', actor });
    if (replay) await expect(result).resolves.toMatchObject({ replayed:true });
    else await expect(result).rejects.toMatchObject({ statusCode:409 });
    expect(client.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE') || sql.includes('INSERT INTO notifications'))).toBe(false);
  }
});
test('notification failure rolls the whole intervention back', async () => {
  const { reject, client } = setup({ failNotifications:true });
  await expect(reject({ requestId:208, reason:'Wrong submission', actor })).rejects.toThrow('Notification failed');
  expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(client.query).not.toHaveBeenCalledWith('COMMIT');
  expect(client.release).toHaveBeenCalled();
});
