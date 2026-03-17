const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const {
  ensureApprovalRouteVersioning,
  getActiveVersion,
  listRoutesForVersion,
  createVersionFromRoutes,
} = require('./utils/approvalRouteVersioning');

const DEFAULT_MIN_AMOUNT = 0;
const DEFAULT_MAX_AMOUNT = 999999999;

const normalizeRoutePayload = (payload = {}) => {
  const sanitizeString = (value, field) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) {
      throw createHttpError(400, `${field} is required`);
    }
    return trimmed;
  };

  const parsePositiveInteger = (value, field) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw createHttpError(400, `${field} must be a positive whole number`);
    }
    return parsed;
  };

  const parseAmount = (value, fallback, field) => {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw createHttpError(400, `${field} must be a non-negative number`);
    }
    return Math.trunc(parsed);
  };

  const requestType = sanitizeString(payload.request_type, 'Request type');
  const departmentType = sanitizeString(
    payload.department_type,
    'Department type',
  ).toLowerCase();
  const role = sanitizeString(payload.role, 'Role');
  const approvalLevel = parsePositiveInteger(
    payload.approval_level,
    'Approval level',
  );
  const minAmount = parseAmount(
    payload.min_amount,
    DEFAULT_MIN_AMOUNT,
    'Minimum amount',
  );
  const maxAmount = parseAmount(
    payload.max_amount,
    DEFAULT_MAX_AMOUNT,
    'Maximum amount',
  );

  if (minAmount > maxAmount) {
    throw createHttpError(
      400,
      'Minimum amount cannot be greater than the maximum amount',
    );
  }

  return {
    request_type: requestType,
    department_type: departmentType,
    approval_level: approvalLevel,
    role,
    min_amount: minAmount,
    max_amount: maxAmount,
  };
};

const ensureManagePermission = req => {
  if (!req.user.hasPermission('permissions.manage')) {
    throw createHttpError(403, 'You do not have permission to modify routes');
  }
};

const hydrateVersionedRoutes = async client => {
  await ensureApprovalRouteVersioning(client);
  const activeVersion = await getActiveVersion(client);
  if (!activeVersion) {
    return { routes: [], activeVersion: null };
  }
  const routes = await listRoutesForVersion(client, activeVersion.id);
  return { routes, activeVersion };
};

const getRoutes = async (req, res, next) => {
  try {
    const { routes, activeVersion } = await hydrateVersionedRoutes(pool);
    res.json({ routes, active_version: activeVersion });
  } catch (err) {
    console.error('❌ Failed to fetch approval routes:', err);
    next(createHttpError(500, 'Failed to fetch approval routes'));
  }
};

const createRoute = async (req, res, next) => {
  let normalizedPayload;
  try {
    ensureManagePermission(req);
    normalizedPayload = normalizeRoutePayload(req.body);
  } catch (err) {
    return next(err);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { routes } = await hydrateVersionedRoutes(client);

    const nextRoutes = [...routes, normalizedPayload];
    const version = await createVersionFromRoutes(client, {
      routes: nextRoutes,
      createdBy: req.user.id,
      changeSummary: 'Created approval route',
      activate: true,
    });
    await client.query('COMMIT');

    res.status(201).json({ ...normalizedPayload, version });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to create approval route:', err);
    next(createHttpError(500, 'Failed to create approval route'));
  } finally {
    client.release();
  }
};

const updateRoute = async (req, res, next) => {
  const { id } = req.params;
  let normalizedPayload;

  try {
    ensureManagePermission(req);
    normalizedPayload = normalizeRoutePayload(req.body);
  } catch (err) {
    return next(err);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const { routes } = await hydrateVersionedRoutes(client);

    const routeIndex = routes.findIndex(route => Number(route.id) === Number(id));
    if (routeIndex < 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Route not found'));
    }

    const nextRoutes = routes.map((route, index) =>
      index === routeIndex ? { ...route, ...normalizedPayload } : route,
    );

    const version = await createVersionFromRoutes(client, {
      routes: nextRoutes,
      createdBy: req.user.id,
      changeSummary: `Updated approval route #${id}`,
      activate: true,
    });

    await client.query('COMMIT');

    res.json({ ...normalizedPayload, id: Number(id), version });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to update approval route:', err);
    next(createHttpError(500, 'Failed to update approval route'));
  } finally {
    client.release();
  }
};

const deleteRoute = async (req, res, next) => {
  const { id } = req.params;

  try {
    ensureManagePermission(req);
  } catch (err) {
    return next(err);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const { routes } = await hydrateVersionedRoutes(client);

    const remainingRoutes = routes.filter(route => Number(route.id) !== Number(id));
    if (remainingRoutes.length === routes.length) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Route not found'));
    }

    await createVersionFromRoutes(client, {
      routes: remainingRoutes,
      createdBy: req.user.id,
      changeSummary: `Deleted approval route #${id}`,
      activate: true,
    });

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to delete approval route:', err);
    next(createHttpError(500, 'Failed to delete approval route'));
  } finally {
    client.release();
  }
};

const findMatchingRouteRoles = (routes, scenario) => {
  const amount = Number.isFinite(Number(scenario.amount)) ? Number(scenario.amount) : 0;
  return routes
    .filter(route => (
      route.request_type === scenario.request_type
      && route.department_type === String(scenario.department_type || '').toLowerCase()
      && amount >= Number(route.min_amount || 0)
      && amount <= Number(route.max_amount || DEFAULT_MAX_AMOUNT)
    ))
    .sort((a, b) => Number(a.approval_level) - Number(b.approval_level))
    .map(route => ({
      approval_level: route.approval_level,
      role: route.role,
    }));
};

const simulateRouteChanges = async (req, res, next) => {
  try {
    ensureManagePermission(req);
    const client = await pool.connect();

    try {
      const { routes, activeVersion } = await hydrateVersionedRoutes(client);
      const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
      const scenarios = Array.isArray(req.body?.scenarios) ? req.body.scenarios : [];

      const simulatedRoutes = [...routes];

      for (const change of changes) {
        const action = String(change.action || '').toLowerCase();
        if (action === 'create') {
          simulatedRoutes.push(normalizeRoutePayload(change.route || change));
          continue;
        }

        if (action === 'update') {
          const routeId = Number(change.id);
          const routeIndex = simulatedRoutes.findIndex(route => Number(route.id) === routeId);
          if (routeIndex < 0) {
            throw createHttpError(400, `Cannot update unknown route ${change.id}`);
          }
          simulatedRoutes[routeIndex] = {
            ...simulatedRoutes[routeIndex],
            ...normalizeRoutePayload(change.route || change),
          };
          continue;
        }

        if (action === 'delete') {
          const routeId = Number(change.id);
          const before = simulatedRoutes.length;
          const filtered = simulatedRoutes.filter(route => Number(route.id) !== routeId);
          if (before === filtered.length) {
            throw createHttpError(400, `Cannot delete unknown route ${change.id}`);
          }
          simulatedRoutes.length = 0;
          simulatedRoutes.push(...filtered);
          continue;
        }

        throw createHttpError(400, 'Simulation changes must specify action: create, update, or delete');
      }

      const scenario_results = scenarios.map(scenario => {
        const current = findMatchingRouteRoles(routes, scenario);
        const simulated = findMatchingRouteRoles(simulatedRoutes, scenario);
        return {
          scenario,
          current,
          simulated,
          changed: JSON.stringify(current) !== JSON.stringify(simulated),
        };
      });

      res.json({
        active_version: activeVersion,
        total_current_routes: routes.length,
        total_simulated_routes: simulatedRoutes.length,
        scenario_results,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('❌ Failed to simulate approval route changes:', err);
    next(err.status ? err : createHttpError(500, 'Failed to simulate route changes'));
  }
};

module.exports = { getRoutes, createRoute, updateRoute, deleteRoute, simulateRouteChanges };