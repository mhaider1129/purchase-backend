const { resolveRouteApprover } = require('../services/requestReclassificationService');

describe('request reclassification approver resolution', () => {
  test('uses the requester for requester route steps', async () => {
    const client = { query: jest.fn() };
    await expect(resolveRouteApprover(client, { role: 'requester' }, { requester_id: 71 })).resolves.toBe(71);
    expect(client.query).not.toHaveBeenCalled();
  });

  test.each([
    ['IT Department HOD', 'it'],
    ['Maintenance Department HOD', 'maintenance'],
  ])('finds the actual HOD for %s', async (role, departmentName) => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ id: 82 }] }) };
    await expect(resolveRouteApprover(client, { role }, { department_id: 4 })).resolves.toBe(82);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("LOWER(u.role)='hod'"), [departmentName]);
  });

  test('treats executive roles as organization-wide', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ id: 93 }] }) };
    await expect(resolveRouteApprover(client, { role: 'CMO' }, { department_id: 4 })).resolves.toBe(93);
    expect(client.query.mock.calls[0][0]).toContain("'cmo','coo','ceo','cfo'");
  });
});