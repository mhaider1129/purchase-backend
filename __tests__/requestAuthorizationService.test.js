'use strict';

const { findAuthorizedRequest, filterAuthorizedRequestItems } = require('../services/requestAuthorizationService');

const baseUser = { id: 7, institute_id: 3, permissions: [] };

describe('canonical request read authorization', () => {
  test.each([
    ['requester', 'r.requester_id = $3'],
    ['approver', 'approver_id = $3'],
    ['whole-request assignee', 'r.assigned_to = $3'],
    ['line-item assignee', 'access_ri.assigned_to = $3'],
  ])('%s access uses the normal application relationship authority', async (_case, sqlFragment) => {
    const database = { query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: 12, institute_id: 3 }] }) };
    const result = await findAuthorizedRequest({ requestId: 12, user: baseUser, database });
    expect(result.request.id).toBe(12);
    expect(database.query.mock.calls[0][0]).toContain(sqlFragment);
    expect(database.query.mock.calls[0][1]).toEqual([12, [3], 7]);
  });

  test('view-all remains restricted to institute scope', async () => {
    const database = { query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [] }) };
    const result = await findAuthorizedRequest({ requestId: 12, user: { ...baseUser, permissions: ['requests.view-all'] }, database });
    expect(result).toBeNull();
    expect(database.query.mock.calls[0][0]).toContain('r.institute_id = ANY');
    expect(database.query.mock.calls[0][1]).toEqual([12, [3]]);
  });

  test('a user with no institute scope is denied without querying', async () => {
    const database = { query: jest.fn() };
    await expect(findAuthorizedRequest({ requestId: 12, user: { id: 7 }, database })).resolves.toBeNull();
    expect(database.query).not.toHaveBeenCalled();
  });

  test('split assignees see only assigned lines and assignees do not see rejected lines', () => {
    const items = [
      { id: 1, assigned_to: 7, approval_status: 'Approved' },
      { id: 2, assigned_to: 8, approval_status: 'Approved' },
      { id: 3, assigned_to: 7, approval_status: 'Rejected' },
    ];
    expect(filterAuthorizedRequestItems(items, { assigned_to: 8, status: 'Approved' }, baseUser, false).map(row => row.id)).toEqual([1]);
  });
});