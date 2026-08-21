'use strict';
const { TOUCH_TYPES } = require('./constants');

const MANUAL_TYPES = new Set(['SUPPLIER_CONTACTED', 'TECHNICAL_CLARIFICATION_REQUESTED', 'NEGOTIATION_ROUND', 'CUSTOMS_STARTED']);
const isTouch = activity => TOUCH_TYPES.has(activity.activity_type) && activity.source !== 'PAGE_VIEW';

function validateManualActivity(input) {
  if (!MANUAL_TYPES.has(input?.activity_type)) throw new TypeError('Manual activity type is not allowed');
  if (!input.procurement_case_id || !input.activity_at || !String(input.notes || '').trim()) throw new TypeError('Case, date/time and note are required');
  return { ...input, source: 'MANUAL', notes: String(input.notes).trim() };
}

function summarizeTouches(activities = []) {
  const touches = activities.filter(isTouch);
  const byType = {}; const bySupplier = {}; const byCase = {};
  for (const item of touches) {
    byType[item.activity_type] = (byType[item.activity_type] || 0) + 1;
    if (item.supplier_id != null) bySupplier[item.supplier_id] = (bySupplier[item.supplier_id] || 0) + 1;
    byCase[item.procurement_case_id] = (byCase[item.procurement_case_id] || 0) + 1;
  }
  return { total: touches.length, byType, bySupplier, byCase };
}

module.exports = { isTouch, summarizeTouches, validateManualActivity, MANUAL_TYPES };