// app.js

const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const os = require('os');
const morgan = require('morgan');
const reassignPendingApprovals = require('./controllers/utils/reassignPendingApprovals');
const remindPendingApprovals = require('./controllers/utils/remindPendingApprovals');
const remindPendingReceipts = require('./controllers/utils/remindPendingReceipts');
const { syncPermissionCatalog } = require('./utils/permissionService');
const { syncUiAccessResources } = require('./utils/uiAccessService');
const { syncCapabilityPolicies } = require('./utils/capabilityPolicyService');
const processScheduledRequests = require('./controllers/utils/processScheduledRequests');
const { loadEnvironmentConfig } = require('./config/environment');
const { writeAuditTrail } = require('./middleware/writeAuditTrail');
const { getRequestBodyLimit } = require('./config/uploadLimits');
const {
  log,
  requestTracingMiddleware,
  metricsHandler,
  errorBudgetHandler,
} = require('./utils/observability');

// Load environment variables
dotenv.config();
const environmentConfig = loadEnvironmentConfig();

// Initialize Express app
const app = express();
console.log(`✅ Environment profile loaded (${environmentConfig.nodeEnv}) with config version ${environmentConfig.appConfigVersion}`);

syncPermissionCatalog()
  .then(() => log('info', 'permission_catalog_synchronized'))
  .catch(err => log('error', 'permission_catalog_sync_failed', { error: err.message }));

syncUiAccessResources()
  .then(() => log('info', 'ui_access_resources_synchronized'))
  .catch(err => log('error', 'ui_access_resource_sync_failed', { error: err.message }));

syncCapabilityPolicies()
  .then(() => log('info', 'capability_policies_synchronized'))
  .catch(err => log('error', 'capability_policies_sync_failed', { error: err.message }));

function getLANIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '0.0.0.0';
}

// =========================
// 🛡️ Middleware Setup
// =========================
const defaultAllowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'https://localhost:3000',
  'https://localhost:5173',
  'https://127.0.0.1:3000',
  'https://127.0.0.1:5173',
  'https://wici-procurement.org',
  'https://www.wici-procurement.org',
];

const stripQuotes = text => text.replace(/^['"]|['"]$/g, '');

const parseOrigins = raw => {
  if (!raw) {
    return [];
  }

  const value = raw.trim();

  if (!value) {
    return [];
  }

  if (value.startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map(item => String(item)).map(stripQuotes);
      }
    } catch (error) {
      log('warn', 'cors_origin_json_parse_failed', { error: error.message });
    }
  }

  return value
    .split(/[\s,;\n\r]+/)
    .map(stripQuotes)
    .map(origin => origin.trim())
    .filter(Boolean);
};

const normalizeOrigin = origin => origin.replace(/\/+$/, '').toLowerCase();

const envConfiguredOrigins = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_ORIGIN,
  process.env.CLIENT_URL,
  process.env.WEBAPP_URL,
  process.env.APP_URL,
  process.env.CORS_ALLOWED_ORIGINS,
  process.env.CORS_ORIGINS,
  process.env.ALLOWED_ORIGINS,
]
  .filter(Boolean)
  .flatMap(value => parseOrigins(value));

const lanIP = getLANIP();
const lanOrigins = [];

if (lanIP && lanIP !== '0.0.0.0') {
  ['3000', '5173'].forEach(port => {
    lanOrigins.push(`http://${lanIP}:${port}`);
    lanOrigins.push(`https://${lanIP}:${port}`);
  });
}

const allowedOrigins = Array.from(
  new Set(
    [...defaultAllowedOrigins, ...envConfiguredOrigins, ...lanOrigins]
      .filter(Boolean)
      .map(normalizeOrigin)
  )
);

if (allowedOrigins.length > 0) {
  log('info', 'cors_origins_configured', { allowedOrigins });
} else {
  log('warn', 'cors_origins_missing');
}

const allowedOriginsSet = new Set(allowedOrigins);

const parseHostName = hostHeader => String(hostHeader || '').split(':')[0].toLowerCase();

const isPrivateHostName = hostName => {
  const normalizedHost = String(hostName || '').toLowerCase();

  return (
    normalizedHost === 'localhost' ||
    normalizedHost === '127.0.0.1' ||
    normalizedHost === '0.0.0.0' ||
    normalizedHost.startsWith('10.') ||
    normalizedHost.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalizedHost)
  );
};

const isAllowedLanFrontendOrigin = origin => {
  try {
    const parsedOrigin = new URL(origin);

    return (
      ['3000', '5173'].includes(parsedOrigin.port) &&
      isPrivateHostName(parsedOrigin.hostname)
    );
  } catch (_error) {
    return false;
  }
};

const isSameHostFrontendOrigin = (origin, req) => {
  try {
    const parsedOrigin = new URL(origin);
    const requestHostName = parseHostName(req.headers.host);

    return (
      parsedOrigin.hostname.toLowerCase() === requestHostName &&
      ['3000', '5173'].includes(parsedOrigin.port)
    );
  } catch (_error) {
    return false;
  }
};

const allowOrigin = (origin, req) =>
  allowedOriginsSet.has('*') ||
  allowedOriginsSet.has(normalizeOrigin(origin)) ||
  isSameHostFrontendOrigin(origin, req) ||
  isAllowedLanFrontendOrigin(origin);

const appendCorsHeaders = (req, res) => {
  const origin = req.headers.origin;

  if (origin && allowOrigin(origin, req)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  res.header('Vary', 'Origin');
  res.header('Access-Control-Expose-Headers', 'Content-Disposition, Content-Type');

  const requestHeaders = req.header('Access-Control-Request-Headers');
  if (requestHeaders) {
    res.header('Access-Control-Allow-Headers', requestHeaders);
  } else {
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  res.header(
    'Access-Control-Allow-Methods',
    'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  );
};

app.use(requestTracingMiddleware);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && !allowOrigin(origin, req)) {
    log('warn', 'cors_origin_blocked', { origin });

    if (req.method === 'OPTIONS') {
      appendCorsHeaders(req, res);
      res.sendStatus(403);
      return;
    }

    res.status(403).json({ message: 'CORS: Origin not allowed' });
    return;
  }

  appendCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});
const requestBodyLimit = getRequestBodyLimit();
app.use(express.json({ limit: requestBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: requestBodyLimit }));
app.use(
  morgan('combined', {
    skip: () => process.env.NODE_ENV === 'test',
  })
);

// =========================
// 🛣️ API Router
// =========================
const apiRouter = express.Router();

// =========================
// 📁 Optional: Serve Uploads (if needed for frontend access)
// =========================
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// =========================
// 🧠 Rate Limiting (Optional for Public Routes)
// =========================
const authRateLimitWindowMs = 15 * 60 * 1000;
const authRateLimitMax = 100;
const authAttempts = new Map();

const resetOldAuthEntries = () => {
  const now = Date.now();
  for (const [key, entry] of authAttempts.entries()) {
    if (now - entry.start > authRateLimitWindowMs) {
      authAttempts.delete(key);
    }
  }
};

setInterval(resetOldAuthEntries, authRateLimitWindowMs).unref();

const authLimiter = (req, res, next) => {
  const key = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = authAttempts.get(key) || { count: 0, start: now };

  if (now - entry.start > authRateLimitWindowMs) {
    entry.count = 0;
    entry.start = now;
  }

  entry.count += 1;
  authAttempts.set(key, entry);

  if (entry.count > authRateLimitMax) {
    return res.status(429).json({ message: 'Too many requests, try again later.' });
  }

  next();
};

// =========================
// 🔄 Route Imports
// =========================
const authRoutes = require('./routes/auth');
const requestsRoutes = require('./routes/requests');
const requestedItemsRoutes = require('./routes/requestedItems');
const approvalsRoutes = require('./routes/approvals');
const auditLogRoutes = require('./routes/auditLog');
const attachmentsRoutes = require('./routes/attachments');
const filesRoutes = require('./routes/files');
const permissionsRouter = require('./routes/permissions');
const adminToolsRoutes = require('./routes/adminTools');
const usersRoutes = require('./routes/users');
const dashboardRoutes = require('./routes/dashboard');
const departmentsRoutes = require('./routes/departments');
const warehousesRoutes = require('./routes/warehouses');
const rolesRoutes = require('./routes/roles');
const maintenanceStockRoutes = require('./routes/maintenanceStock');
const procurementPlansRoutes = require('./routes/procurementPlans');
const planningRoutes = require('./routes/planning');
const stockItemsRoutes = require('./routes/stockItems');
const stockItemRequestsRoutes = require('./routes/stockItemRequests');
const itemMasterRoutes = require('./routes/itemMaster');
const warehouseSupplyRoutes = require('./routes/warehouseSupply');
const warehouseInventoryRoutes = require('./routes/warehouseInventory');
const warehouseTransfersRoutes = require('./routes/warehouseTransfers');
const approvalRoutesRoutes = require('./routes/approvalRoutes');
const warehouseSupplyTemplatesRoutes = require('./routes/warehouseSupplyTemplates');
const projectsRoutes = require('./routes/projects');
const custodyRoutes = require('./routes/custody');
const itemRecallsRoutes = require('./routes/itemRecalls');
const contractsRoutes = require('./routes/contracts');
const contractTemplatesRoutes = require('./routes/contractTemplates');
const contractClausesRoutes = require('./routes/contractClauses');
const suppliersRoutes = require('./routes/suppliers');
const supplierEvaluationsRoutes = require('./routes/supplierEvaluations');
const supplierSrmRoutes = require('./routes/supplierSrm');
const technicalInspectionsRoutes = require('./routes/technicalInspections');
const contractEvaluationsRouter = require('./routes/contractEvaluations');
const riskManagementRoutes = require('./routes/riskManagement');
const rfxPortalRoutes = require('./routes/rfxPortal');
const uiAccessRoutes = require('./routes/uiAccess');
const capabilityPoliciesRoutes = require('./routes/capabilityPolicies');
const notificationsRoutes = require('./routes/notifications');
const dispensingRoutes = require('./routes/dispensing');
const procureToPayRoutes = require('./routes/procureToPay');
const auditRegistryRoutes = require('./routes/auditRegistry');
const tasksRoutes = require('./routes/tasks');
const budgetControlRoutes = require('./routes/budgetControl');
const requestAutoAssignmentRulesRoutes = require('./routes/requestAutoAssignmentRules');
const departmentRequestedItemsRoutes = require('./routes/departmentRequestedItems');
const procurementEvaluationsRoutes = require('./routes/procurementEvaluations');
const printServiceRequestsRoutes = require('./routes/printServiceRequests');

const { authenticateUser, authenticateUserOptional } = require('./middleware/authMiddleware');
const errorHandler = require('./middleware/errorHandler');

// =========================
// 🔓 Public Routes
// =========================
app.use('/api/auth', authLimiter);
app.use('/api/auth', authRoutes);

// =========================
// 🔒 Protected Routes
// =========================
const protectedApiRoutes = [
  { path: '/files', router: filesRoutes },
  { path: '/requests', router: requestsRoutes },
  { path: '/requested-items', router: requestedItemsRoutes },
  { path: '/approvals', router: approvalsRoutes },
  { path: '/audit-log', router: auditLogRoutes },
  { path: '/attachments', router: attachmentsRoutes },
  { path: '/admin-tools', router: adminToolsRoutes },
  { path: '/users', router: usersRoutes },
  { path: '/dashboard', router: dashboardRoutes },
  { path: '/departments', router: departmentsRoutes },
  { path: '/warehouses', router: warehousesRoutes },
  { path: '/roles', router: rolesRoutes },
  { path: '/permissions', router: permissionsRouter },
  { path: '/maintenance-stock', router: maintenanceStockRoutes },
  { path: '/procurement-plans', router: procurementPlansRoutes },
  { path: '/planning', router: planningRoutes },
  { path: '/stock-items', router: stockItemsRoutes },
  { path: '/stock-item-requests', router: stockItemRequestsRoutes },
  { path: '/item-master', router: itemMasterRoutes },
  { path: '/warehouse-inventory', router: warehouseInventoryRoutes },
  { path: '/item-recalls', router: itemRecallsRoutes },
  { path: '/warehouse-supply', router: warehouseSupplyRoutes },
  { path: '/warehouse-transfers', router: warehouseTransfersRoutes },
  { path: '/approval-routes', router: approvalRoutesRoutes },
  { path: '/warehouse-supply-templates', router: warehouseSupplyTemplatesRoutes },
  { path: '/projects', router: projectsRoutes },
  { path: '/custody', router: custodyRoutes },
  { path: '/contracts', router: contractsRoutes },
  { path: '/contract-templates', router: contractTemplatesRoutes },
  { path: '/contract-clauses', router: contractClausesRoutes },
  { path: '/suppliers', router: suppliersRoutes },
  { path: '/supplier-evaluations', router: supplierEvaluationsRoutes },
  { path: '/supplier-srm', router: supplierSrmRoutes },
  { path: '/technical-inspections', router: technicalInspectionsRoutes },
  { path: '/contract-evaluations', router: contractEvaluationsRouter },
  { path: '/risk-management', router: riskManagementRoutes },
  { path: '/rfx-portal', router: rfxPortalRoutes, authenticate: authenticateUserOptional },
  { path: '/ui-access', router: uiAccessRoutes },
  { path: '/capability-policies', router: capabilityPoliciesRoutes },
  { path: '/notifications', router: notificationsRoutes },
  { path: '/dispensing', router: dispensingRoutes },
  { path: '/procure-to-pay', router: procureToPayRoutes },
  { path: '/audit-registry', router: auditRegistryRoutes },
  { path: '/tasks', router: tasksRoutes },
  { path: '/budget-control', router: budgetControlRoutes },
  { path: '/request-auto-assignment-rules', router: requestAutoAssignmentRulesRoutes },
  { path: '/department-requested-items', router: departmentRequestedItemsRoutes },
  { path: '/procurement-evaluations', router: procurementEvaluationsRoutes },
  { path: '/print-service-requests', router: printServiceRequestsRoutes },
];

const mountApiRoutes = router => {
  protectedApiRoutes.forEach(({ path: routePath, router: routeHandler, authenticate = authenticateUser }) => {
    router.use(routePath, authenticate, writeAuditTrail, routeHandler);
  });
};

mountApiRoutes(apiRouter);

// Mount the API router
app.use('/api', apiRouter);

// =========================
// 🛠️ Utility Routes
// =========================
app.get('/health', (req, res) => {
  res.status(200).json({ status: '✅ OK', timestamp: new Date(), requestId: req.requestId });
});

app.get('/metrics', metricsHandler);
app.get('/error-budget', errorBudgetHandler);

// =========================
// 🚫 404 Fallback Handler
// =========================
app.use((req, res) => {
  res.status(404).json({ success: false, message: '🔍 Route not found' });
});

// =========================
// 🧯 Global Error Handler
// =========================
app.use(errorHandler);

// =========================
// 🚀 Start Server
// =========================

const startServer = (port = process.env.PORT || 5000, host = process.env.HOST || getLANIP()) => {
  const server = app.listen(port, host, async () => {
    log('info', 'server_started', { host, port });
    try {
      await reassignPendingApprovals();
      log('info', 'pending_approvals_reassigned_on_startup');
      await remindPendingApprovals();
      await remindPendingReceipts();
      await processScheduledRequests();
      setInterval(() => {
        processScheduledRequests().catch(err =>
          log('error', 'scheduled_request_processor_failed', { error: err.message })
        );
        remindPendingApprovals().catch(err =>
          log('error', 'reminder_job_failed', { error: err.message })
        );
        remindPendingReceipts().catch(err =>
          log('error', 'receipt_reminder_job_failed', { error: err.message })
        );
      }, 24 * 60 * 60 * 1000); // daily
    } catch (err) {
      log('error', 'startup_reassignment_failed', { error: err.message });
    }
  });

  return server;
};

if (require.main === module) {
  startServer();
}

module.exports = app;
module.exports.startServer = startServer;