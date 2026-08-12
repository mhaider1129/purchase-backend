'use strict';

// Eligibility is deliberately limited to facts represented by the checked-in
// schema. Category qualification and a blacklist registry do not exist yet.
const evaluateSupplierEligibility = (facts) => {
  const reasons = [];
  if (!facts?.supplier) reasons.push('SUPPLIER_NOT_FOUND');
  else if (['inactive', 'suspended', 'blacklisted'].includes(String(facts.supplier.status || '').toLowerCase())) reasons.push('SUPPLIER_INACTIVE');
  if (facts?.complianceBlocked) reasons.push('COMPLIANCE_BLOCKED');
  return { eligible: reasons.length === 0, reasons, deferredChecks: facts?.deferredChecks || [] };
};

const assertSupplierEligible = (facts) => {
  const result = evaluateSupplierEligibility(facts);
  if (!result.eligible) {
    const error = new Error(`Supplier is ineligible: ${result.reasons.join(', ')}`);
    error.code = 'SUPPLIER_INELIGIBLE';
    error.reasons = result.reasons;
    throw error;
  }
  return result;
};

const loadAndAssertSupplierEligible = async (repository, supplierId) => {
  const facts = await repository.loadSupplierEligibilityFacts(supplierId);
  return { ...facts, ...assertSupplierEligible(facts) };
};

module.exports = { evaluateSupplierEligibility, assertSupplierEligible, loadAndAssertSupplierEligible };