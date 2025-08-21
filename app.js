// app.js

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const os = require('os');
const pool = require('./config/db');
const reassignPendingApprovals = require('./controllers/utils/reassignPendingApprovals');
const remindPendingApprovals = require('./controllers/utils/remindPendingApprovals');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();

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
app.use(cors());
app.use(express.json());

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
const adminToolsRoutes = require('./routes/adminTools');
const usersRoutes = require('./routes/users');
const dashboardRoutes = require('./routes/dashboard');
const departmentsRoutes = require('./routes/departments');
const rolesRoutes = require('./routes/roles');
const maintenanceStockRoutes = require('./routes/maintenanceStock');
const procurementPlansRoutes = require('./routes/procurementPlans');
const stockItemsRoutes = require('./routes/stockItems');
const stockItemRequestsRoutes = require('./routes/stockItemRequests');
const warehouseSupplyRoutes = require('./routes/warehouseSupply');
const approvalRoutesRoutes = require('./routes/approvalRoutes');
const warehouseSupplyTemplatesRoutes = require('./routes/warehouseSupplyTemplates');

const { authenticateUser } = require('./middleware/authMiddleware');
const errorHandler = require('./middleware/errorHandler');

// =========================
// 🔓 Public Routes
// =========================
app.use('/auth', authRoutes);
app.use('/api/files', filesRoutes); // Optional: consider protecting this too

// =========================
// 🔒 Protected Routes
// =========================
app.use('/api/requests', authenticateUser, requestsRoutes);
app.use('/api/requested-items', authenticateUser, requestedItemsRoutes);
app.use('/api/approvals', authenticateUser, approvalsRoutes);
app.use('/api/audit-log', authenticateUser, auditLogRoutes);
app.use('/api/attachments', authenticateUser, attachmentsRoutes);
app.use('/api/admin-tools', authenticateUser, adminToolsRoutes);
app.use('/api/users', authenticateUser, usersRoutes);
app.use('/api/dashboard', authenticateUser, dashboardRoutes);
app.use('/api/departments', authenticateUser, departmentsRoutes);
app.use('/api/roles', authenticateUser, rolesRoutes);
app.use('/api/maintenance-stock', authenticateUser, maintenanceStockRoutes);
app.use('/api/procurement-plans', authenticateUser, procurementPlansRoutes);
app.use('/api/stock-items', authenticateUser, stockItemsRoutes);
app.use('/api/stock-item-requests', authenticateUser, stockItemRequestsRoutes);
app.use('/api/warehouse-supply', authenticateUser, warehouseSupplyRoutes);
app.use('/api/approval-routes', authenticateUser, approvalRoutesRoutes);
app.use('/api/warehouse-supply-templates', authenticateUser, warehouseSupplyTemplatesRoutes);

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
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || getLANIP();
app.listen(PORT, HOST, async () => {
  console.log(`🚀 Server started on http://${HOST}:${PORT}`);
  try {
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
