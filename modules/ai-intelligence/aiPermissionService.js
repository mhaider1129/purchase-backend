'use strict';

const { aiError } = require('./aiErrors');

function requirePermissions(context, permissions) {
  const granted = new Set(context.permissions);
  const missing = permissions.filter(permission => !granted.has(permission));
  if (missing.length) throw aiError(403, 'AI_TOOL_FORBIDDEN', 'You do not have permission to access this information');
}

const TOOL_PERMISSIONS = Object.freeze({
  get_request_summary: ['requests.view-all'],
  get_pending_approvals: [],
  get_procurement_cases: ['procurement-performance.view'],
  get_supplier_summary: ['procurement-performance.view'],
  get_supply_chain_kpis: ['procurement-performance.view'],
  get_attention_items: ['procurement-performance.view'],
});

function authorizeTool(context, toolName) {
  requirePermissions(context, ['ai-intelligence.use', ...(TOOL_PERMISSIONS[toolName] || [])]);
}

module.exports = { authorizeTool, requirePermissions, TOOL_PERMISSIONS };