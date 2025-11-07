const PERMISSION_DEFINITIONS = [
  {
    code: 'users.manage',
    name: 'Manage users',
    description: 'Assign roles, update department or section, and deactivate users.',
  },
  {
    code: 'users.view',
    name: 'View all users',
    description: 'Access the directory of all platform users.',
  },
  {
    code: 'departments.manage',
    name: 'Manage departments',
    description: 'Create or edit departments and their sections.',
  },
  {
    code: 'dashboard.view',
    name: 'View management dashboard',
    description: 'Access aggregated procurement statistics.',
  },
  {
    code: 'approvals.reassign',
    name: 'Reassign approvals',
    description: 'Trigger mass reassignment of pending approvals.',
  },
  {
    code: 'requests.view-all',
    name: 'View all requests',
    description: 'List requests from all departments.',
  },
  {
    code: 'requests.manage',
    name: 'Manage requests lifecycle',
    description: 'Update request statuses, mark as completed, and adjust estimated cost.',
  },
  {
    code: 'projects.manage',
    name: 'Manage projects',
    description: 'Create, deactivate, and view procurement projects.',
  },
  {
    code: 'procurement.update-status',
    name: 'Update procurement status',
    description: 'Modify procurement state and comments for requested items.',
  },
  {
    code: 'procurement.update-cost',
    name: 'Update procurement cost',
    description: 'Set the unit cost and total cost for requested items.',
  },
  {
    code: 'warehouse.manage-supply',
    name: 'Record warehouse supply',
    description: 'Record supplied items for approved warehouse requests.',
  },
  {
    code: 'warehouse.view-supply',
    name: 'View warehouse supply requests',
    description: 'Access warehouse supply queues for fulfillment.',
  },
  {
    code: 'stock-requests.create',
    name: 'Create stock item requests',
    description: 'Submit new items to be stocked by the warehouse.',
  },
  {
    code: 'stock-requests.review',
    name: 'Review stock item requests',
    description: 'View and approve stock item requests.',
  },
  {
    code: 'contracts.manage',
    name: 'Manage contracts',
    description: 'Create, update, archive, and view contract evaluations.',
  },
  {
    code: 'evaluations.manage',
    name: 'Manage supplier evaluations',
    description: 'Create and review supplier evaluations.',
  },
  {
    code: 'recalls.view',
    name: 'View recall queues',
    description: 'Access recall dashboards for procurement and warehouse.',
  },
  {
    code: 'recalls.manage',
    name: 'Manage recalls',
    description: 'Create and update recall requests.',
  },
  {
    code: 'permissions.manage',
    name: 'Manage role permissions',
    description: 'Assign platform permissions to user roles.',
  },
];

const DEFAULT_ROLE_PERMISSIONS = {
  admin: ['*'],
  scm: [
    'users.manage',
    'users.view',
    'departments.manage',
    'dashboard.view',
    'approvals.reassign',
    'requests.view-all',
    'requests.manage',
    'projects.manage',
    'procurement.update-status',
    'procurement.update-cost',
    'stock-requests.review',
    'contracts.manage',
    'evaluations.manage',
    'recalls.view',
    'recalls.manage',
    'permissions.manage',
  ],
  warehousemanager: [
    'warehouse.view-supply',
    'warehouse.manage-supply',
    'stock-requests.create',
    'recalls.view',
    'recalls.manage',
  ],
  warehouse_manager: [
    'warehouse.view-supply',
    'warehouse.manage-supply',
    'stock-requests.create',
    'recalls.view',
    'recalls.manage',
  ],
  warehouse_keeper: [
    'warehouse.view-supply',
    'warehouse.manage-supply',
    'stock-requests.create',
    'recalls.manage',
  ],
  warehousekeeper: [
    'warehouse.view-supply',
    'warehouse.manage-supply',
    'stock-requests.create',
    'recalls.manage',
  ],
  procurementspecialist: [
    'requests.view-all',
    'requests.manage',
    'procurement.update-status',
    'procurement.update-cost',
    'recalls.view',
  ],
  contractmanager: [
    'contracts.manage',
    'requests.view-all',
  ],
  coo: [
    'requests.view-all',
    'requests.manage',
    'contracts.manage',
    'projects.manage',
  ],
};

module.exports = {
  PERMISSION_DEFINITIONS,
  DEFAULT_ROLE_PERMISSIONS,
};