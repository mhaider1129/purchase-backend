'use strict';
const { parseDecimal, formatDecimal } = require('../purchaseOrderTotalsService');

function verifiedHardSavings({ baselineAmount, finalAmount, currency }) {
  if (!/^[A-Z]{3}$/.test(String(currency || ''))) throw new TypeError('ISO currency is required');
  const value = parseDecimal(baselineAmount) - parseDecimal(finalAmount);
  if (value < 0n) throw new RangeError('Final amount exceeds savings baseline');
  return { valueType: 'HARD_SAVINGS', verifiedValue: formatDecimal(value), currency };
}

function aggregateByCurrency(events = []) {
  const result = {};
  for (const event of events) {
    const key = `${event.valueType}:${event.currency}`;
    result[key] = formatDecimal((result[key] ? parseDecimal(result[key]) : 0n) + parseDecimal(event.verifiedValue));
  }
  return result;
}

function weightedCreditDays(awards = []) {
  let value = 0n; let weighted = 0n;
  for (const award of awards) {
    const amount = parseDecimal(award.amount);
    value += amount;
    weighted += amount * BigInt(award.creditDays || 0);
  }
  if (value === 0n) return null;
  const hundredths = (weighted * 100n + value / 2n) / value;
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
}

function validateValueEvent(input, actor) {
  if (!actor?.canVerifySavings || !actor.id) throw Object.assign(new Error('Savings verifier permission required'), { statusCode: 403 });
  if (String(input.enteredBy) === String(actor.id)) throw Object.assign(new Error('An ordinary event author cannot self-verify'), { statusCode: 403 });
  if (!input.evidenceEntityType || !input.evidenceEntityId) throw new TypeError('Evidence entity reference is required');
  if (input.valueType === 'HARD_SAVINGS') return { ...input, ...verifiedHardSavings(input), verifiedBy: actor.id };
  if (input.valueType !== 'COST_AVOIDANCE' || !String(input.notes || '').trim()) throw new TypeError('Cost avoidance requires value, evidence and notes');
  const currency=String(input.currency||'').trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency)) throw new TypeError('ISO currency is required');
  const value=parseDecimal(input.verifiedValue); if(value<0n) throw new RangeError('Cost avoidance cannot be negative');
  return { ...input, verifiedValue:formatDecimal(value), currency, notes:String(input.notes).trim(), verifiedBy: actor.id };
}

async function verifyValueEvent({repository,input,actor}){
  const row=validateValueEvent(input,actor);
  return repository.withTransaction(async tx=>{
    const current=await tx.lockCase(row.procurementCaseId); if(!current) throw Object.assign(new Error('Procurement case not found'),{statusCode:404});
    const saved=await tx.insertValueEvent(row);
    await tx.writeAudit({entity_type:'procurement_value_event',entity_id:saved.id,action:`${row.valueType}_VERIFIED`,actor_user_id:actor.id,reason:row.notes||'Evidence-backed verification',metadata:{procurement_case_id:row.procurementCaseId,currency:row.currency,verified_value:row.verifiedValue}});
    return saved;
  });
}

module.exports = { verifiedHardSavings, validateValueEvent, verifyValueEvent, aggregateByCurrency, weightedCreditDays };