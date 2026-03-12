// app.js

const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const os = require('os');
const morgan = require('morgan');
const reassignPendingApprovals = require('./controllers/utils/reassignPendingApprovals');
const remindPendingApprovals = require('./controllers/utils/remindPendingApprovals');
const { syncPermissionCatalog } = require('./utils/permissionService');
const { syncUiAccessResources } = require('./utils/uiAccessService');
const ensureWarehouseAssignments = require('./utils/ensureWarehouseAssignments');
const { loadEnvironmentConfig } = require('./config/environment');
const { writeAuditTrail } = require('./middleware/writeAuditTrail');
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

ensureWarehouseAssignments()
  .then(() => log('info', 'warehouse_assignment_columns_ensured'))
  .catch(err => log('error', 'warehouse_assignment_ensure_failed', { error: err.message }));

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

const allowOrigin = origin =>
  allowedOriginsSet.has('*') || allowedOriginsSet.has(normalizeOrigin(origin));

const appendCorsHeaders = (req, res) => {
  const origin = req.headers.origin;

  if (origin && allowOrigin(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  res.header('Vary', 'Origin');

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

  if (origin && !allowOrigin(origin)) {
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
app.use(express.json());
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
const warehouseSupplyRoutes = require('./routes/warehouseSupply');
const warehouseInventoryRoutes = require('./routes/warehouseInventory');
const warehouseTransfersRoutes = require('./routes/warehouseTransfers');
const approvalRoutesRoutes = require('./routes/approvalRoutes');
const warehouseSupplyTemplatesRoutes = require('./routes/warehouseSupplyTemplates');
const projectsRoutes = require('./routes/projects');
const custodyRoutes = require('./routes/custody');
const itemRecallsRoutes = require('./routes/itemRecalls');
const contractsRoutes = require('./routes/contracts');
const suppliersRoutes = require('./routes/suppliers');
const supplierEvaluationsRoutes = require('./routes/supplierEvaluations');
const supplierSrmRoutes = require('./routes/supplierSrm');
const technicalInspectionsRoutes = require('./routes/technicalInspections');
const contractEvaluationsRouter = require('./routes/contractEvaluations');
const riskManagementRoutes = require('./routes/riskManagement');
const rfxPortalRoutes = require('./routes/rfxPortal');
const uiAccessRoutes = require('./routes/uiAccess');
const notificationsRoutes = require('./routes/notifications');
const dispensingRoutes = require('./routes/dispensing');
const procureToPayRoutes = require('./routes/procureToPay');

const { authenticateUser, authenticateUserOptional } = require('./middleware/authMiddleware');
const errorHandler = require('./middleware/errorHandler');

// =========================
// 🔓 Public Routes
// =========================
app.use('/auth', authLimiter);
app.use('/auth', authRoutes);

// =========================
// 🔒 Protected Routes
// =========================
apiRouter.use('/files', authenticateUser, writeAuditTrail, filesRoutes);
apiRouter.use('/requests', authenticateUser, writeAuditTrail, requestsRoutes);
apiRouter.use('/requested-items', authenticateUser, writeAuditTrail, requestedItemsRoutes);
apiRouter.use('/approvals', authenticateUser, writeAuditTrail, approvalsRoutes);
apiRouter.use('/audit-log', authenticateUser, writeAuditTrail, auditLogRoutes);
apiRouter.use('/attachments', authenticateUser, writeAuditTrail, attachmentsRoutes);
apiRouter.use('/admin-tools', authenticateUser, writeAuditTrail, adminToolsRoutes);
apiRouter.use('/users', authenticateUser, writeAuditTrail, usersRoutes);
apiRouter.use('/dashboard', authenticateUser, writeAuditTrail, dashboardRoutes);
apiRouter.use('/departments', authenticateUser, writeAuditTrail, departmentsRoutes);
apiRouter.use('/warehouses', authenticateUser, writeAuditTrail, warehousesRoutes);
apiRouter.use('/roles', authenticateUser, writeAuditTrail, rolesRoutes);
apiRouter.use('/permissions', authenticateUser, writeAuditTrail, permissionsRouter);
apiRouter.use('/maintenance-stock', authenticateUser, writeAuditTrail, maintenanceStockRoutes);
apiRouter.use('/procurement-plans', authenticateUser, writeAuditTrail, procurementPlansRoutes);
apiRouter.use('/planning', authenticateUser, writeAuditTrail, planningRoutes);
apiRouter.use('/stock-items', authenticateUser, writeAuditTrail, stockItemsRoutes);
apiRouter.use('/stock-item-requests', authenticateUser, writeAuditTrail, stockItemRequestsRoutes);
apiRouter.use('/warehouse-inventory', authenticateUser, writeAuditTrail, warehouseInventoryRoutes);
apiRouter.use('/item-recalls', authenticateUser, writeAuditTrail, itemRecallsRoutes);
apiRouter.use('/warehouse-supply', authenticateUser, writeAuditTrail, warehouseSupplyRoutes);
apiRouter.use('/warehouse-transfers', authenticateUser, writeAuditTrail, warehouseTransfersRoutes);
apiRouter.use('/approval-routes', authenticateUser, writeAuditTrail, approvalRoutesRoutes);
apiRouter.use('/warehouse-supply-templates', authenticateUser, writeAuditTrail, warehouseSupplyTemplatesRoutes);
apiRouter.use('/projects', authenticateUser, writeAuditTrail, projectsRoutes);
apiRouter.use('/custody', authenticateUser, writeAuditTrail, custodyRoutes);
apiRouter.use('/contracts', authenticateUser, writeAuditTrail, contractsRoutes);
apiRouter.use('/suppliers', authenticateUser, writeAuditTrail, suppliersRoutes);
apiRouter.use('/supplier-evaluations', authenticateUser, writeAuditTrail, supplierEvaluationsRoutes);
apiRouter.use('/supplier-srm', authenticateUser, writeAuditTrail, supplierSrmRoutes);
apiRouter.use('/technical-inspections', authenticateUser, writeAuditTrail, technicalInspectionsRoutes);
apiRouter.use('/contract-evaluations', authenticateUser, writeAuditTrail, contractEvaluationsRouter);
apiRouter.use('/risk-management', authenticateUser, writeAuditTrail, riskManagementRoutes);
apiRouter.use('/rfx-portal', authenticateUserOptional, writeAuditTrail, rfxPortalRoutes);
apiRouter.use('/ui-access', authenticateUser, writeAuditTrail, uiAccessRoutes);
apiRouter.use('/notifications', authenticateUser, writeAuditTrail, notificationsRoutes);
apiRouter.use('/dispensing', authenticateUser, writeAuditTrail, dispensingRoutes);
apiRouter.use('/procure-to-pay', authenticateUser, writeAuditTrail, procureToPayRoutes);

// Mount the API router
app.use('/api', apiRouter);
app.use('/api/api', apiRouter); // Alias for malformed client requests

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
const { ensureEvaluationCriteriaTable } = require('./utils/evaluationCriteriaSeeder');

const startServer = (port = process.env.PORT || 5000, host = process.env.HOST || getLANIP()) => {
  const server = app.listen(port, host, async () => {
    log('info', 'server_started', { host, port });
    try {
      await ensureEvaluationCriteriaTable();
      await reassignPendingApprovals();
      log('info', 'pending_approvals_reassigned_on_startup');
      await remindPendingApprovals();
      setInterval(() => {
        remindPendingApprovals().catch(err =>
          log('error', 'reminder_job_failed', { error: err.message })
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
