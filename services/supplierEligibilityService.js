'use strict';

const evaluateSupplierEligibility = (supplier, { categoryId = null, contractId = null, at = new Date() } = {}) => {
  const reasons = [];
  if (!supplier) reasons.push('SUPPLIER_NOT_FOUND');
  else {
    if (supplier.is_active === false || ['inactive', 'suspended', 'blacklisted'].includes(String(supplier.status).toLowerCase())) reasons.push('SUPPLIER_INACTIVE');
    if (supplier.qualification_status && !['qualified', 'approved'].includes(String(supplier.qualification_status).toLowerCase())) reasons.push('NOT_QUALIFIED');
    if (supplier.compliance_status && !['compliant', 'approved', 'current'].includes(String(supplier.compliance_status).toLowerCase())) reasons.push('NON_COMPLIANT');
    if (supplier.suspended_until && new Date(supplier.suspended_until) >= at) reasons.push('SUPPLIER_SUSPENDED');
    if (categoryId && Array.isArray(supplier.eligible_category_ids) && !supplier.eligible_category_ids.map(String).includes(String(categoryId))) reasons.push('CATEGORY_INELIGIBLE');
    if (contractId && Array.isArray(supplier.eligible_contract_ids) && !supplier.eligible_contract_ids.map(String).includes(String(contractId))) reasons.push('CONTRACT_INELIGIBLE');
  }
  return { eligible: reasons.length === 0, reasons };
};
const assertSupplierEligible = (supplier, context) => {
  const result = evaluateSupplierEligibility(supplier, context);
  if (!result.eligible) { const error = new Error(`Supplier is ineligible: ${result.reasons.join(', ')}`); error.code = 'SUPPLIER_INELIGIBLE'; error.reasons = result.reasons; throw error; }
  return result;
};
const loadAndAssertSupplierEligible = async (repository, supplierId, context) => {
  const facts = await repository.getEligibilityFacts(supplierId, context);
  return { supplier: facts.supplier, ...assertSupplierEligible(facts.supplier, { ...context, categoryId: null, contractId: null }), deferred: facts.deferred || [] };
};
module.exports = { evaluateSupplierEligibility, assertSupplierEligible, loadAndAssertSupplierEligible };