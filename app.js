// app.js

const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const os = require('os');
const pool = require('./config/db');
const reassignPendingApprovals = require('./controllers/utils/reassignPendingApprovals');
const remindPendingApprovals = require('./controllers/utils/remindPendingApprovals');
const { syncPermissionCatalog } = require('./utils/permissionService');
const { syncUiAccessResources } = require('./utils/uiAccessService');
const ensureWarehouseAssignments = require('./utils/ensureWarehouseAssignments');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();

syncPermissionCatalog()
  .then(() => console.log('✅ Permission catalog synchronized'))
  .catch(err => console.error('❌ Failed to synchronize permission catalog:', err));

syncUiAccessResources()
  .then(() => console.log('✅ UI access resources synchronized'))
  .catch(err => console.error('❌ Failed to synchronize UI access resources:', err));

ensureWarehouseAssignments()
  .then(() => console.log('✅ Warehouse assignment columns ensured'))
  .catch(err => console.error('❌ Failed to ensure warehouse assignment columns:', err));

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
      console.warn('⚠️ Failed to parse JSON CORS origin list, falling back to delimiter parsing.', error.message);
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
  console.log('✅ Allowed CORS origins:', allowedOrigins);
} else {
  console.warn('⚠️ No CORS origins configured — only same-origin requests without an Origin header will be accepted.');
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

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && !allowOrigin(origin)) {
    console.warn(`🚫 Blocked CORS origin: ${origin}`);

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
// const rateLimit = require('express-rate-limit');
// const authLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 100,
//   message: 'Too many requests, try again later.',
// });
// app.use('/auth', authLimiter);

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
const stockItemsRoutes = require('./routes/stockItems');
const stockItemRequestsRoutes = require('./routes/stockItemRequests');
const warehouseSupplyRoutes = require('./routes/warehouseSupply');
const warehouseInventoryRoutes = require('./routes/warehouseInventory');
const approvalRoutesRoutes = require('./routes/approvalRoutes');
const warehouseSupplyTemplatesRoutes = require('./routes/warehouseSupplyTemplates');
const projectsRoutes = require('./routes/projects');
const custodyRoutes = require('./routes/custody');
const itemRecallsRoutes = require('./routes/itemRecalls');
const contractsRoutes = require('./routes/contracts');
const supplierEvaluationsRoutes = require('./routes/supplierEvaluations');
const technicalInspectionsRoutes = require('./routes/technicalInspections');
const contractEvaluationsRouter = require('./routes/contractEvaluations');
const uiAccessRoutes = require('./routes/uiAccess');
const notificationsRoutes = require('./routes/notifications');

const { authenticateUser } = require('./middleware/authMiddleware');
const errorHandler = require('./middleware/errorHandler');

// =========================
// 🔓 Public Routes
// =========================
app.use('/auth', authRoutes);
apiRouter.use('/files', filesRoutes); // Optional: consider protecting this too

// =========================
// 🔒 Protected Routes
// =========================
apiRouter.use('/requests', authenticateUser, requestsRoutes);
apiRouter.use('/requested-items', authenticateUser, requestedItemsRoutes);
apiRouter.use('/approvals', authenticateUser, approvalsRoutes);
apiRouter.use('/audit-log', authenticateUser, auditLogRoutes);
apiRouter.use('/attachments', authenticateUser, attachmentsRoutes);
apiRouter.use('/admin-tools', authenticateUser, adminToolsRoutes);
apiRouter.use('/users', authenticateUser, usersRoutes);
apiRouter.use('/dashboard', authenticateUser, dashboardRoutes);
apiRouter.use('/departments', authenticateUser, departmentsRoutes);
apiRouter.use('/warehouses', authenticateUser, warehousesRoutes);
apiRouter.use('/roles', authenticateUser, rolesRoutes);
apiRouter.use('/permissions', authenticateUser, permissionsRouter);
apiRouter.use('/maintenance-stock', authenticateUser, maintenanceStockRoutes);
apiRouter.use('/procurement-plans', authenticateUser, procurementPlansRoutes);
apiRouter.use('/stock-items', authenticateUser, stockItemsRoutes);
apiRouter.use('/stock-item-requests', authenticateUser, stockItemRequestsRoutes);
apiRouter.use('/warehouse-inventory', authenticateUser, warehouseInventoryRoutes);
apiRouter.use('/item-recalls', authenticateUser, itemRecallsRoutes);
apiRouter.use('/warehouse-supply', authenticateUser, warehouseSupplyRoutes);
apiRouter.use('/approval-routes', authenticateUser, approvalRoutesRoutes);
apiRouter.use('/warehouse-supply-templates', authenticateUser, warehouseSupplyTemplatesRoutes);
apiRouter.use('/projects', authenticateUser, projectsRoutes);
apiRouter.use('/custody', authenticateUser, custodyRoutes);
apiRouter.use('/contracts', authenticateUser, contractsRoutes);
apiRouter.use('/supplier-evaluations', authenticateUser, supplierEvaluationsRoutes);
apiRouter.use('/technical-inspections', authenticateUser, technicalInspectionsRoutes);
apiRouter.use('/contract-evaluations', authenticateUser, contractEvaluationsRouter);
apiRouter.use('/ui-access', authenticateUser, uiAccessRoutes);
apiRouter.use('/notifications', authenticateUser, notificationsRoutes);

// Mount the API router
app.use('/api', apiRouter);
app.use('/api/api', apiRouter); // Alias for malformed client requests

// =========================
// 🛠️ Utility Routes
// =========================
app.get('/departments', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM departments');
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: '✅ OK', timestamp: new Date() });
});

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
    console.log(`🚀 Server started on http://${host}:${port}`);
    try {
      await ensureEvaluationCriteriaTable();
      await reassignPendingApprovals();
      console.log('🔄 Pending approvals reassigned on startup');
      await remindPendingApprovals();
      setInterval(() => {
        remindPendingApprovals().catch(err =>
          console.error('❌ Reminder job failed:', err)
        );
      }, 24 * 60 * 60 * 1000); // daily
    } catch (err) {
      console.error('❌ Auto-reassignment error on startup:', err);
    }
  });

  return server;
};

if (require.main === module) {
  startServer();
}

module.exports = app;
module.exports.startServer = startServer;
