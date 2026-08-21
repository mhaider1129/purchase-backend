'use strict';
const elapsed = (start, end) => start && end ? new Date(end).getTime() - new Date(start).getTime() : null;
function calculateCycleTimes(t = {}) {
  return {
    approvalTime: elapsed(t.submittedAt, t.fullyApprovedAt),
    sourcingTime: elapsed(t.sourcingStartedAt || t.assignedAt, t.commerciallyReadyAt),
    technicalEvaluationTime: elapsed(t.technicalEvaluationRequestedAt, t.technicalEvaluationCompletedAt),
    poProcessingTime: elapsed(t.awardAt, t.poAt),
    supplierLeadTime: elapsed(t.poAt, t.shipmentAt),
    logisticsLeadTime: elapsed(t.shipmentAt, t.deliveryAt),
    totalEndToEndTime: elapsed(t.submittedAt, t.deliveryAt),
  };
}
module.exports = { calculateCycleTimes };