'use strict';

const MODEL_VERSION = 'PCS-1.0';
const CLASS_BANDS = Object.freeze([
  { code: 'A', label: 'Routine Procurement', min: 1, max: 20, workloadUnits: 1 },
  { code: 'B', label: 'Standard Sourcing', min: 21, max: 40, workloadUnits: 2 },
  { code: 'C', label: 'Specialized Procurement', min: 41, max: 60, workloadUnits: 4 },
  { code: 'D', label: 'Strategic / International Procurement', min: 61, max: 80, workloadUnits: 7 },
  { code: 'E', label: 'Critical / Exceptional Procurement', min: 81, max: 100, workloadUnits: 10 },
]);

const FACTORS = Object.freeze({
  supplier_availability: { existing_supplier: 1, multiple_known: 3, sourcing_required: 7, no_known_supplier: 10 },
  market_availability: { local: 1, iraq: 3, regional: 6, international_scarce: 10 },
  technical_specialization: { commodity: 1, specialized: 5, highly_technical: 8, oem_proprietary: 10 },
  quotation_difficulty: { routine: 1, comparison_required: 4, limited_responses: 7, exceptional: 10 },
  importation_logistics: { none: 1, domestic: 3, international_courier: 7, formal_import: 10 },
  payment_terms: { standard_credit: 1, cod: 4, partial_advance: 7, advance_or_lc: 10 },
  technical_evaluation: { none: 1, document_review: 4, specialist_review: 7, trial_or_committee: 10 },
  negotiation_effort: { none: 1, single_round: 4, multiple_rounds: 7, exceptional: 10 },
  documentation_compliance: { standard: 1, additional: 4, regulated: 7, multi_authority: 10 },
  urgency: { normal: 1, priority: 4, urgent: 7, emergency: 10 },
});

const TOUCH_TYPES = new Set([
  'SUPPLIER_CONTACTED', 'RFQ_SENT', 'RFQ_RESPONSE_RECEIVED', 'QUOTATION_RECEIVED',
  'TECHNICAL_CLARIFICATION_REQUESTED', 'TECHNICAL_EVALUATION_REQUESTED',
  'TECHNICAL_EVALUATION_COMPLETED', 'NEGOTIATION_STARTED', 'NEGOTIATION_ROUND',
  'REVISED_QUOTATION_RECEIVED', 'PAYMENT_TERMS_NEGOTIATED', 'SHIPMENT_BOOKED',
  'SHIPMENT_DISPATCHED', 'SHIPMENT_ARRIVED', 'CUSTOMS_STARTED', 'CUSTOMS_CLEARED',
  'DELIVERY_COMPLETED',
]);

module.exports = { MODEL_VERSION, CLASS_BANDS, FACTORS, TOUCH_TYPES };