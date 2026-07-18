const APPROVAL_ROLE_LABELS = {
  HOD: 'HOD',
  CMO: 'CMO',
  SCM: 'SCM',
  COO: 'COO',
  WAREHOUSE: 'Warehouse',
  WAREHOUSEMANAGER: 'Warehouse',
  WAREHOUSE_MANAGER: 'Warehouse',
};

const getMaintenanceApprovalLabel = (role, level) => {
  const normalizedRole = String(role || '').trim().toUpperCase().replace(/\s+/g, '_');
  return APPROVAL_ROLE_LABELS[normalizedRole] || `Level ${level}`;
};

const buildMaintenanceApprovalNotification = ({ requestId, role, level, status }) => {
  const approvalLabel = getMaintenanceApprovalLabel(role, level);
  const rejected = status === 'Rejected';

  return {
    title: rejected
      ? `Maintenance request ${requestId} rejected`
      : `${approvalLabel} approval completed`,
    message: rejected
      ? `${approvalLabel} rejected the maintenance request you submitted (ID: ${requestId}).`
      : `${approvalLabel} approved the maintenance request you submitted (ID: ${requestId}).`,
    action: rejected ? 'maintenance_rejected' : 'maintenance_step_approved',
    approvalLabel,
  };
};

module.exports = {
  buildMaintenanceApprovalNotification,
  getMaintenanceApprovalLabel,
};