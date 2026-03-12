const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const CAPABILITY_MATRIX = [
  {
    routePrefix: '/admin-tools',
    module: 'platform-governance',
    resource: 'admin-tools',
    permissions: ['users.manage', 'approvals.reassign'],
  },
  {
    routePrefix: '/permissions',
    module: 'platform-governance',
    resource: 'permission-catalog',
    permissions: ['permissions.manage'],
  },
  {
    routePrefix: '/roles',
    module: 'platform-governance',
    resource: 'role-management',
    permissions: ['roles.manage'],
  },
  {
    routePrefix: '/users',
    module: 'identity-access',
    resource: 'user-management',
    permissions: ['users.manage'],
  },
  {
    routePrefix: '/ui-access',
    module: 'identity-access',
    resource: 'ui-resource-policy',
    permissions: ['permissions.manage'],
  },
  {
    routePrefix: '/requests',
    module: 'procurement',
    resource: 'requests',
    permissions: ['requests.manage', 'requests.view-all'],
  },
  {
    routePrefix: '/requested-items',
    module: 'procurement',
    resource: 'requested-items',
    permissions: ['requests.manage', 'procurement.update-status', 'procurement.update-cost'],
  },
  {
    routePrefix: '/approvals',
    module: 'procurement',
    resource: 'approvals',
    permissions: ['approvals.reassign', 'requests.manage'],
  },
  {
    routePrefix: '/contracts',
    module: 'sourcing',
    resource: 'contracts',
    permissions: ['contracts.manage'],
  },
  {
    routePrefix: '/suppliers',
    module: 'sourcing',
    resource: 'suppliers',
    permissions: ['contracts.manage'],
  },
  {
    routePrefix: '/supplier-evaluations',
    module: 'sourcing',
    resource: 'supplier-evaluations',
    permissions: ['evaluations.manage'],
  },
  {
    routePrefix: '/supplier-srm',
    module: 'sourcing',
    resource: 'supplier-srm',
    permissions: ['evaluations.manage'],
  },
  {
    routePrefix: '/rfx-portal',
    module: 'sourcing',
    resource: 'rfx-portal',
    permissions: ['rfx.manage', 'rfx.respond'],
  },
  {
    routePrefix: '/warehouse-inventory',
    module: 'warehouse',
    resource: 'inventory',
    permissions: ['warehouse.manage-supply', 'warehouse.view-supply'],
  },
  {
    routePrefix: '/warehouse-supply',
    module: 'warehouse',
    resource: 'supply',
    permissions: ['warehouse.manage-supply', 'warehouse.view-supply'],
  },
  {
    routePrefix: '/warehouse-transfers',
    module: 'warehouse',
    resource: 'transfers',
    permissions: ['warehouse.manage-supply', 'warehouse.view-supply'],
  },
  {
    routePrefix: '/stock-items',
    module: 'warehouse',
    resource: 'stock-items',
    permissions: ['warehouse.manage-supply'],
  },
  {
    routePrefix: '/stock-item-requests',
    module: 'warehouse',
    resource: 'stock-item-requests',
    permissions: ['stock-requests.create', 'stock-requests.review'],
  },
  {
    routePrefix: '/item-recalls',
    module: 'quality',
    resource: 'item-recalls',
    permissions: ['recalls.manage', 'recalls.view'],
  },
  {
    routePrefix: '/risk-management',
    module: 'risk',
    resource: 'risk-register',
    permissions: ['risks.manage', 'risks.view'],
  },
];

const normalizePath = (path = '') => {
  const sanitized = path.split('?')[0] || '';
  return sanitized.startsWith('/api/') ? sanitized.slice(4) : sanitized;
};

const resolveCapability = (path = '', method = 'GET') => {
  const normalizedPath = normalizePath(path);
  const entry = CAPABILITY_MATRIX.find((item) => normalizedPath.startsWith(item.routePrefix));

  if (!entry) {
    return {
      module: 'unknown',
      resource: normalizedPath || 'unknown',
      action: WRITE_METHODS.has(method.toUpperCase()) ? 'write' : 'read',
      permissions: [],
    };
  }

  return {
    module: entry.module,
    resource: entry.resource,
    action: WRITE_METHODS.has(method.toUpperCase()) ? 'write' : 'read',
    permissions: entry.permissions,
  };
};

module.exports = {
  CAPABILITY_MATRIX,
  WRITE_METHODS,
  resolveCapability,
};