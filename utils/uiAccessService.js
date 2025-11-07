const pool = require('../config/db');

const defaultResources = [
  {
    resourceKey: 'feature.stockItemRequests',
    label: 'Stock Item Request Form',
    description: 'Controls access to the stock item request workflow.',
    permissions: ['stock-requests.create'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.itemRecalls',
    label: 'Item Recalls',
    description: 'Allows viewing and managing item recalls.',
    permissions: ['recalls.view', 'recalls.manage'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.maintenanceWarehouseSupply',
    label: 'Maintenance Warehouse Supply Request',
    description: 'Enables access to the maintenance warehouse supply request form.',
    permissions: ['warehouse.manage-supply', 'stock-requests.create'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.custody',
    label: 'Custody Issue & Issued Lists',
    description: 'Controls the custody issue and issued pages.',
    permissions: ['warehouse.manage-supply'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.maintenanceStock',
    label: 'Maintenance Stock',
    description: 'Shows the maintenance stock dashboard.',
    permissions: ['warehouse.manage-supply'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.warehouseTemplates',
    label: 'Warehouse Supply Templates',
    description: 'Allows users to manage warehouse supply templates.',
    permissions: ['warehouse.manage-supply'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.warehouseRequests',
    label: 'Warehouse Supply Requests',
    description: 'Grants access to warehouse supply request tracking.',
    permissions: ['warehouse.view-supply', 'warehouse.manage-supply'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.adminTools',
    label: 'Admin Tools',
    description: 'Controls access to the admin tools re-assignment panel.',
    permissions: ['approvals.reassign'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.management',
    label: 'System Management',
    description: 'Shows the system management workspace.',
    permissions: ['users.manage', 'departments.manage', 'permissions.manage', 'projects.manage'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.allRequests',
    label: 'All Requests',
    description: 'Allows viewing all purchase requests.',
    permissions: ['requests.view-all'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.procurementPlans',
    label: 'Procurement Plans',
    description: 'Controls access to procurement plans.',
    permissions: ['procurement.update-status', 'procurement.update-cost'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.contracts',
    label: 'Contracts Workspace',
    description: 'Shows the contracts management page and navigation.',
    permissions: ['contracts.manage'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.supplierEvaluations',
    label: 'Supplier Evaluations',
    description: 'Allows managing supplier evaluations.',
    permissions: ['evaluations.manage'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.procurementQueues',
    label: 'Procurement Queues',
    description: 'Controls assigned and completed procurement queues.',
    permissions: ['procurement.update-status'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.incompleteRequests',
    label: 'Incomplete Requests Overview',
    description: 'Allows viewing the incomplete request queues.',
    permissions: ['requests.view-all'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.incompleteMedical',
    label: 'Incomplete Medical Requests',
    description: 'Controls the medical incomplete queue.',
    permissions: ['requests.view-all'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.incompleteOperational',
    label: 'Incomplete Operational Requests',
    description: 'Controls the operational incomplete queue.',
    permissions: ['requests.view-all'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.auditRequests',
    label: 'Audit Requests',
    description: 'Allows access to the audit review workspace.',
    permissions: ['requests.view-all'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.warehouseDetail',
    label: 'Warehouse Supply Detail',
    description: 'Controls access to individual warehouse supply sheets.',
    permissions: ['warehouse.manage-supply', 'warehouse.view-supply'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.dashboard',
    label: 'Dashboard',
    description: 'Controls the executive dashboard visibility.',
    permissions: ['dashboard.view'],
    requireAll: false,
  },
  {
    resourceKey: 'feature.analytics',
    label: 'Lifecycle Analytics',
    description: 'Controls the lifecycle analytics view.',
    permissions: ['dashboard.view'],
    requireAll: false,
  },
];

const ensureTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ui_resource_permissions (
      resource_key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT,
      permissions TEXT[] NOT NULL DEFAULT '{}',
      require_all BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
};

const normalizePermissionList = (permissions) => {
  if (typeof permissions === 'string') {
    permissions = permissions
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (!Array.isArray(permissions)) {
    return [];
  }
  const seen = new Set();
  const normalized = [];
  for (const permission of permissions) {
    if (typeof permission !== 'string') continue;
    const trimmed = permission.trim();
    if (!trimmed) continue;
    const normalizedCode = trimmed.toLowerCase();
    if (seen.has(normalizedCode)) continue;
    seen.add(normalizedCode);
    normalized.push(normalizedCode);
  }
  return normalized;
};

const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n', ''].includes(normalized)) {
      return false;
    }
  }

  return undefined;
};

const syncUiAccessResources = async () => {
  await ensureTable();
  for (const resource of defaultResources) {
    const { resourceKey, label, description, permissions, requireAll } = resource;
    const existing = await pool.query(
      `SELECT permissions, require_all FROM ui_resource_permissions WHERE resource_key = $1`,
      [resourceKey]
    );

    if (existing.rowCount === 0) {
      await pool.query(
        `INSERT INTO ui_resource_permissions (resource_key, label, description, permissions, require_all)
         VALUES ($1, $2, $3, $4, $5)`,
        [resourceKey, label, description, normalizePermissionList(permissions), requireAll]
      );
      continue;
    }

    await pool.query(
      `UPDATE ui_resource_permissions
         SET label = $2,
             description = $3
       WHERE resource_key = $1`,
      [resourceKey, label, description]
    );

    const row = existing.rows[0];
    const currentPermissions = Array.isArray(row.permissions)
      ? row.permissions.filter(Boolean)
      : [];

    if (currentPermissions.length === 0) {
      await pool.query(
        `UPDATE ui_resource_permissions
           SET permissions = $2
         WHERE resource_key = $1`,
        [resourceKey, normalizePermissionList(permissions)]
      );
    }

    if (row.require_all === null) {
      await pool.query(
        `UPDATE ui_resource_permissions
           SET require_all = $2
         WHERE resource_key = $1`,
        [resourceKey, Boolean(requireAll)]
      );
    }
  }
};

const listUiResources = async () => {
  await ensureTable();
  const { rows } = await pool.query(
    `SELECT resource_key, label, description, permissions, require_all
       FROM ui_resource_permissions
      ORDER BY resource_key`
  );
  return rows.map((row) => ({
    resource_key: row.resource_key,
    label: row.label,
    description: row.description,
    permissions: Array.isArray(row.permissions)
      ? row.permissions.filter(Boolean)
      : [],
    require_all: Boolean(row.require_all),
  }));
};

const updateUiResource = async (resourceKey, permissions, requireAll) => {
  await ensureTable();
  const normalizedPermissions = normalizePermissionList(permissions);
  const params = [resourceKey];
  const sets = [];

  if (permissions !== undefined) {
    params.push(normalizedPermissions);
    sets.push(`permissions = $${params.length}`);
  }

  if (requireAll !== undefined) {
    const normalizedBoolean = normalizeBoolean(requireAll);
    if (normalizedBoolean !== undefined) {
      params.push(normalizedBoolean);
      sets.push(`require_all = $${params.length}`);
    }
  }

  if (sets.length === 0) {
    const { rows } = await pool.query(
      `SELECT resource_key, label, description, permissions, require_all
         FROM ui_resource_permissions
        WHERE resource_key = $1`,
      [resourceKey]
    );
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0];
    return {
      resource_key: row.resource_key,
      label: row.label,
      description: row.description,
      permissions: Array.isArray(row.permissions) ? row.permissions.filter(Boolean) : [],
      require_all: Boolean(row.require_all),
    };
  }

  const query = `
    UPDATE ui_resource_permissions
       SET ${sets.join(', ')}
     WHERE resource_key = $1
     RETURNING resource_key, label, description, permissions, require_all`;

  const { rows } = await pool.query(query, params);
  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    resource_key: row.resource_key,
    label: row.label,
    description: row.description,
    permissions: Array.isArray(row.permissions) ? row.permissions.filter(Boolean) : [],
    require_all: Boolean(row.require_all),
  };
};

module.exports = {
  syncUiAccessResources,
  listUiResources,
  updateUiResource,
};