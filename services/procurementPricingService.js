'use strict';
const selectPrice = ({ contractPrice, award, directPurchase, manualOverride, canOverride = false, at = new Date() }) => {
  if (contractPrice && (!contractPrice.effective_from || new Date(contractPrice.effective_from) <= at) && (!contractPrice.effective_to || new Date(contractPrice.effective_to) >= at)) return { unit_price: String(contractPrice.unit_price), currency: contractPrice.currency, price_source_type: 'CONTRACT_LINE', price_source_id: contractPrice.id };
  if (award && ['QUOTATION', 'FRAMEWORK_AGREEMENT'].includes(award.source_type)) return { unit_price: String(award.unit_price), currency: award.currency, price_source_type: award.source_type, price_source_id: award.source_id || award.id };
  if (directPurchase) return { unit_price: String(directPurchase.unit_price), currency: directPurchase.currency, price_source_type: 'DIRECT_PURCHASE', price_source_id: directPurchase.id };
  if (manualOverride) { if (!canOverride) throw Object.assign(new Error('Manual price override is not authorized'), { code: 'PRICE_OVERRIDE_FORBIDDEN' }); return { unit_price: String(manualOverride.unit_price), currency: manualOverride.currency, price_source_type: 'MANUAL_OVERRIDE', price_source_id: manualOverride.approval_id }; }
  throw Object.assign(new Error('No governed price source is available'), { code: 'PRICE_SOURCE_REQUIRED' });
};
module.exports = { selectPrice };