'use strict';

const { aiError } = require('./aiErrors');

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const omitted = value => value == null || (typeof value === 'string' && value.trim() === '');
const integer = (value, name) => {
  if (omitted(value)) throw aiError(400, 'AI_INVALID_PARAMETERS', `${name} must be a positive integer`);
  if (typeof value !== 'number' && typeof value !== 'string') throw aiError(400, 'AI_INVALID_PARAMETERS', `${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw aiError(400, 'AI_INVALID_PARAMETERS', `${name} must be a positive integer`);
  return parsed;
};
const optionalInteger = (value, name) => omitted(value) ? undefined : integer(value, name);
const limit = value => {
  if (omitted(value)) return 50;
  const parsed = integer(value, 'limit');
  if (parsed > 200) throw aiError(400, 'AI_INVALID_PARAMETERS', 'limit must not exceed 200');
  return parsed;
};
const date = (value, name, required = false) => {
  if (omitted(value) && !required) return undefined;
  const parsed = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00Z`)
    : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw aiError(400, 'AI_INVALID_PARAMETERS', `${name} must be a valid YYYY-MM-DD date`);
  }
  return value;
};
const text = (value, name) => {
  if (omitted(value)) return undefined;
  if (typeof value !== 'string' || value.length > 100) throw aiError(400, 'AI_INVALID_PARAMETERS', `${name} must be a non-empty string`);
  return value.trim();
};
function only(input, allowed) {
  if (!object(input)) throw aiError(400, 'AI_INVALID_PARAMETERS', 'Tool parameters must be an object');
  const unknown = Object.keys(input).filter(key => !allowed.includes(key));
  if (unknown.length) throw aiError(400, 'AI_INVALID_PARAMETERS', `Unknown parameter(s): ${unknown.join(', ')}`);
}

const validators = {
  get_request_summary(input) { only(input, ['requestId']); return { requestId: integer(input.requestId, 'requestId') }; },
  get_pending_approvals(input) { only(input, ['departmentId','requestType','ageDays','limit']); return { departmentId: optionalInteger(input.departmentId,'departmentId'), requestType:text(input.requestType,'requestType'), ageDays:optionalInteger(input.ageDays,'ageDays'), limit:limit(input.limit) }; },
  get_procurement_cases(input) { only(input, ['status','departmentId','buyerId','supplierId','complexity','ageMin','ageMax','dateFrom','dateTo','limit']); return { status:text(input.status,'status'),departmentId:optionalInteger(input.departmentId,'departmentId'),buyerId:optionalInteger(input.buyerId,'buyerId'),supplierId:optionalInteger(input.supplierId,'supplierId'),complexity:text(input.complexity,'complexity'),ageMin:optionalInteger(input.ageMin,'ageMin'),ageMax:optionalInteger(input.ageMax,'ageMax'),dateFrom:date(input.dateFrom,'dateFrom'),dateTo:date(input.dateTo,'dateTo'),limit:limit(input.limit) }; },
  get_supplier_summary(input) { only(input, ['supplierId']); return { supplierId:integer(input.supplierId,'supplierId') }; },
  get_supply_chain_kpis(input) { only(input, ['dateFrom','dateTo','departmentId','buyerId']); const output={dateFrom:date(input.dateFrom,'dateFrom',true),dateTo:date(input.dateTo,'dateTo',true),departmentId:optionalInteger(input.departmentId,'departmentId'),buyerId:optionalInteger(input.buyerId,'buyerId')}; if(output.dateFrom>output.dateTo) throw aiError(400,'AI_INVALID_PARAMETERS','dateFrom must not be after dateTo'); return output; },
  get_attention_items(input) { only(input, ['dateFrom','dateTo','departmentId','buyerId','limit']); return {dateFrom:date(input.dateFrom,'dateFrom'),dateTo:date(input.dateTo,'dateTo'),departmentId:optionalInteger(input.departmentId,'departmentId'),buyerId:optionalInteger(input.buyerId,'buyerId'),limit:limit(input.limit)}; },
};

function validateChat(body) {
  if (!object(body) || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 4000) throw aiError(400,'AI_INVALID_REQUEST','message is required and must not exceed 4000 characters');
  if (body.conversationId != null && (typeof body.conversationId !== 'string' || body.conversationId.length > 100)) throw aiError(400,'AI_INVALID_REQUEST','conversationId must be a string of at most 100 characters');
  if (body.context != null && !object(body.context)) throw aiError(400,'AI_INVALID_REQUEST','context must be an object');
  const rawContext=body.context || {};
  only(rawContext,['page','entityType','entityId']);
  const context={
    page:text(rawContext.page,'context.page'),
    entityType:text(rawContext.entityType,'context.entityType'),
    entityId:rawContext.entityId == null ? undefined : String(rawContext.entityId).trim(),
  };
  if(context.entityId !== undefined && (!context.entityId || context.entityId.length>100)) throw aiError(400,'AI_INVALID_REQUEST','context.entityId must not exceed 100 characters');
  return { message:body.message.trim(), conversationId:body.conversationId || null, context };
}

module.exports = { validators, validateChat };