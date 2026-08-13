'use strict';
const { loadAndAssertSupplierEligible } = require('./supplierEligibilityService');
const { calculatePurchaseOrderTotals, compareDecimal } = require('./purchaseOrderTotalsService');
const { commitPurchaseOrder } = require('./budgetCommitmentService');
const defaultAudit = require('./auditService');
const defaultOutbox = require('./notificationOutboxService');
const createPurchaseOrderFromAwards = async ({ repository, awardIds, quantities = {}, actor, input = {} }) => repository.withTransaction(async (tx) => {
  if (!Array.isArray(awardIds) || !awardIds.length) throw Object.assign(new Error('At least one award is required'), { code: 'AWARD_REQUIRED' });
  const awards = await tx.lockAwards(awardIds);
  if (awards.length !== awardIds.length || awards.some((award) => award.status !== 'ACTIVE')) throw Object.assign(new Error('An active award was not found'), { code: 'AWARD_NOT_FOUND' });
  const supplierId = String(awards[0].supplier_id);
  if (awards.some((award) => String(award.supplier_id) !== supplierId) || (input.supplier_id && String(input.supplier_id) !== supplierId)) throw Object.assign(new Error('PO supplier must match every award supplier'), { code: 'PO_SUPPLIER_MISMATCH' });
  const requestId = String(awards[0].request_id);
  if (awards.some((award) => String(award.request_id) !== requestId)) throw Object.assign(new Error('Awards on a PO must belong to one request'), { code: 'PO_REQUEST_MISMATCH' });
  const currencies = new Set(awards.map((award) => String(award.currency).toUpperCase()));
  if (currencies.size !== 1) throw Object.assign(new Error('PO awards must use one currency'), { code: 'PO_CURRENCY_MISMATCH' });
  const conversions = new Map();
  for (const award of awards) {
    const conversion = await tx.getAwardConversion(award.id);
    const quantity = String(quantities[award.id] ?? award.awarded_quantity);
    if (compareDecimal(quantity, 0) <= 0 || compareDecimal(quantity, conversion.remaining_quantity) > 0) throw Object.assign(new Error('PO quantity exceeds remaining award quantity'), { code: 'AWARD_QUANTITY_EXCEEDED' });
    conversions.set(String(award.id), quantity);
  }
  const header = await tx.insertHeader({ ...input, request_id: awards[0].request_id, supplier_id: awards[0].supplier_id, currency: awards[0].currency, status: 'PO_DRAFT', created_by: actor.id });
  const lines = [];
  for (const award of awards) lines.push(await tx.insertLine({ purchase_order_id: header.id, request_id: award.request_id, request_item_id: award.request_item_id, requested_item_id: award.request_item_id, award_id: award.id, quantity: conversions.get(String(award.id)), unit_price: award.unit_price, price_source_type: award.source_type, price_source_id: award.source_id || award.id, line_type: award.line_type }));
  return { ...header, lines };
});
const event = async (tx, auditService, outbox, action, po, actor, metadata = {}) => {
  await auditService.writeAuditEvent({ client: tx.client, entityType: 'purchase_order', entityId: po.id, requestId: po.request_id, action, actorUserId: actor.id, metadata });
  await outbox.enqueueNotification(tx.client, { type: action, entityType: 'purchase_order', entityId: po.id, payload: { purchase_order_id: po.id, ...metadata }, idempotencyKey: `${action.toLowerCase()}:${po.id}` });
};
const releasePurchaseOrder = async ({ repository, purchaseOrderId, actor, auditService = defaultAudit, outbox = defaultOutbox }) => repository.withTransaction(async (tx) => {
  const po = await tx.lockPurchaseOrder(purchaseOrderId);
  if (!po) throw Object.assign(new Error('Purchase order not found'), { code: 'PO_NOT_FOUND', statusCode: 404 });
  const key = `po-release:${purchaseOrderId}`;
  if (po.status === 'PO_ISSUED') return { purchaseOrder: await tx.loadPurchaseOrder(po.id), commitment: await tx.findCommitmentByIdempotency(key) };
  if (po.status !== 'PO_APPROVED' || !po.approved_at || !po.approved_by) throw Object.assign(new Error('PO must have completed approval before issue'), { code: 'INVALID_PO_TRANSITION', statusCode: 409 });
  const lines = await tx.loadPurchaseOrderLines(po.id);
  await loadAndAssertSupplierEligible(tx, po.supplier_id);
  for (const line of lines) if (!line.award_id || !line.requested_item_id || !line.price_source_type || !line.price_source_id) throw Object.assign(new Error('PO line traceability and price provenance are required'), { code: 'PO_LINE_TRACE_REQUIRED', statusCode: 409 });
  const totals = calculatePurchaseOrderTotals({ lines, freight: po.freight, charges: po.charges });
  const commitment = await commitPurchaseOrder({ repository: tx, purchaseOrder: { ...po, grand_total: totals.grand_total }, idempotencyKey: key, actor });
  const issued = await tx.markPurchaseOrderIssued(po.id, totals, actor.id);
  await event(tx, auditService, outbox, 'BUDGET_COMMITTED', issued, actor, { commitment_id: commitment.id });
  await event(tx, auditService, outbox, 'PO_ISSUED', issued, actor, { commitment_id: commitment.id });
  return { purchaseOrder: { ...issued, lines }, commitment };
});
const submitPurchaseOrder = ({ repository, purchaseOrderId, actor, approvalRoute, auditService = defaultAudit, outbox = defaultOutbox }) => repository.withTransaction(async tx => { const po=await tx.lockPurchaseOrder(purchaseOrderId); if (!po) throw Object.assign(new Error('Purchase order not found'),{statusCode:404}); if(po.status!=='PO_DRAFT') throw Object.assign(new Error(`Purchase order cannot be submitted from ${po.status}`),{code:'INVALID_PO_TRANSITION',statusCode:409}); const updated=await tx.markPurchaseOrderSubmitted(po.id,approvalRoute); await event(tx,auditService,outbox,'PO_SUBMITTED_FOR_APPROVAL',updated,actor); return updated; });
const approvePurchaseOrder = ({ repository, purchaseOrderId, actor, auditService = defaultAudit, outbox = defaultOutbox }) => repository.withTransaction(async tx => { const po=await tx.lockPurchaseOrder(purchaseOrderId); if (!po) throw Object.assign(new Error('Purchase order not found'),{statusCode:404}); if(po.status!=='PO_PENDING_APPROVAL') throw Object.assign(new Error(`Purchase order cannot be approved from ${po.status}`),{code:'INVALID_PO_TRANSITION',statusCode:409}); const updated=await tx.markPurchaseOrderApproved(po.id,actor.id); await event(tx,auditService,outbox,'PO_APPROVED',updated,actor); return updated; });
const cancelPurchaseOrder = ({ repository, purchaseOrderId, reason, actor, auditService = defaultAudit, outbox = defaultOutbox }) => repository.withTransaction(async tx => { const po=await tx.lockPurchaseOrder(purchaseOrderId); if(!po) throw Object.assign(new Error('Purchase order not found'),{statusCode:404}); if(po.status==='PO_CANCELLED') return { purchaseOrder:po,commitment:await tx.findCommitmentByIdempotency(`po-release:${po.id}`) }; if(await tx.hasPurchaseOrderReceipts(po.id)) throw Object.assign(new Error('Receipt return or reversal is required'),{code:'RECEIPT_RETURN_OR_REVERSAL_REQUIRED',statusCode:409}); const commitment=await tx.findCommitmentByIdempotency(`po-release:${po.id}`); const updated=await tx.markPurchaseOrderCancelled(po.id,reason,actor.id); if(commitment?.state==='ACTIVE'){ await tx.releaseCommitment(commitment.id); await event(tx,auditService,outbox,'BUDGET_COMMITMENT_RELEASED',updated,actor,{commitment_id:commitment.id}); } await event(tx,auditService,outbox,'PO_CANCELLED',updated,actor,{reason}); return {purchaseOrder:updated,commitment}; });
const closePurchaseOrder = ({ repository, purchaseOrderId, reason = '', actor, auditService = defaultAudit, outbox = defaultOutbox }) => repository.withTransaction(async tx => {
  const po = await tx.lockPurchaseOrder(purchaseOrderId);
  if (!po) throw Object.assign(new Error('Purchase order not found'), { code: 'PO_NOT_FOUND', statusCode: 404 });
  if (po.status === 'PO_CLOSED') return { purchaseOrder: po, commitment: null };
  if (!['PO_ISSUED', 'PO_PARTIAL', 'PO_DELIVERED'].includes(po.status)) throw Object.assign(new Error(`Purchase order cannot be closed from ${po.status}`), { code: 'INVALID_PO_TRANSITION', statusCode: 409 });

  const totals = await tx.calculatePurchaseOrderReceiptTotals(po.id);
  const fullyDelivered = compareDecimal(totals?.ordered_quantity || '0', '0') > 0
    && compareDecimal(totals?.received_quantity || '0', totals?.ordered_quantity || '0') >= 0;
  const governedReason = String(reason || '').trim();
  if (!fullyDelivered && !governedReason) throw Object.assign(new Error('Reason is required to close a PO before full delivery'), { code: 'PO_CLOSE_REASON_REQUIRED', statusCode: 400 });

  const commitment = await tx.lockActivePoEncumbrance(po.id);
  if (commitment && compareDecimal(commitment.amount, '0') < 0) throw Object.assign(new Error('Active PO encumbrance cannot be negative'), { code: 'INVALID_PO_ENCUMBRANCE', statusCode: 409 });
  const released = commitment ? await tx.releaseCommitment(commitment.id) : null;
  if (commitment && !released) throw Object.assign(new Error('Active PO encumbrance changed while closing'), { code: 'PO_ENCUMBRANCE_CONFLICT', statusCode: 409 });
  if (released?.budget_envelope_id) await tx.synchronizeBudgetConsumedProjection(released.budget_envelope_id);

  const updated = await tx.markPurchaseOrderClosed(po.id, governedReason || null, actor.id);
  if (released && compareDecimal(released.amount, '0') > 0) await event(tx, auditService, outbox, 'BUDGET_COMMITMENT_RELEASED', updated, actor, { commitment_id: released.id, amount: released.amount });
  await event(tx, auditService, outbox, 'PO_CLOSED', updated, actor, { reason: governedReason || null });
  return { purchaseOrder: updated, commitment: released };
});
module.exports = { createPurchaseOrderFromAwards, releasePurchaseOrder, submitPurchaseOrder, approvePurchaseOrder, cancelPurchaseOrder, closePurchaseOrder };