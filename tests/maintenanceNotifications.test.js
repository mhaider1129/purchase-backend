const {
  buildMaintenanceApprovalNotification,
  getMaintenanceApprovalLabel,
} = require('../utils/maintenanceNotifications');

describe('maintenance approval notifications', () => {
  test.each([
    ['HOD', 'HOD'],
    ['CMO', 'CMO'],
    ['SCM', 'SCM'],
    ['COO', 'COO'],
    ['WarehouseManager', 'Warehouse'],
  ])('labels the %s approval step as %s', (role, expected) => {
    expect(getMaintenanceApprovalLabel(role, 3)).toBe(expected);
  });

  it('builds a role-specific approval notification', () => {
    expect(buildMaintenanceApprovalNotification({
      requestId: 42,
      role: 'SCM',
      level: 3,
      status: 'Approved',
    })).toEqual({
      title: 'SCM approval completed',
      message: 'SCM approved the maintenance request you submitted (ID: 42).',
      action: 'maintenance_step_approved',
      approvalLabel: 'SCM',
    });
  });

  it('clearly identifies a rejection and the rejecting stage', () => {
    expect(buildMaintenanceApprovalNotification({
      requestId: 42,
      role: 'COO',
      level: 4,
      status: 'Rejected',
    })).toMatchObject({
      title: 'Maintenance request 42 rejected',
      message: 'COO rejected the maintenance request you submitted (ID: 42).',
      action: 'maintenance_rejected',
    });
  });
});