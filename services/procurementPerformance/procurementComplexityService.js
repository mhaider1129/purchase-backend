'use strict';
const { MODEL_VERSION, CLASS_BANDS, FACTORS } = require('./constants');

function classify(score) {
  const band = CLASS_BANDS.find(item => score >= item.min && score <= item.max);
  if (!band) throw new RangeError('Complexity score must be between 1 and 100');
  return { complexityClass: band.code, complexityLabel: band.label, workloadUnits: band.workloadUnits };
}

function scoreFacts(facts, modelVersion = MODEL_VERSION) {
  if (modelVersion !== MODEL_VERSION) throw new RangeError(`Unsupported complexity model: ${modelVersion}`);
  const entries = Object.entries(FACTORS).map(([factor, values]) => {
    const value = facts?.[factor];
    if (!Object.prototype.hasOwnProperty.call(values, value)) throw new TypeError(`Invalid or missing ${factor}`);
    return { factor, value, points: values[value] };
  });
  const score = entries.reduce((sum, entry) => sum + entry.points, 0);
  return { score, ...classify(score), modelVersion, factors: entries };
}

async function assessComplexity({ repository, caseId, facts, actorId, reason, canManage, modelVersion = MODEL_VERSION }) {
  if (!canManage) throw Object.assign(new Error('Complexity management permission required'), { statusCode: 403 });
  if (!actorId || !String(reason || '').trim()) throw new TypeError('Actor and assessment reason are required');
  const result = scoreFacts(facts, modelVersion);
  return repository.withTransaction(async tx => {
    const current = await tx.lockCase(caseId);
    if (!current) throw Object.assign(new Error('Procurement case not found'), { statusCode: 404 });
    if (current.closed_at) throw Object.assign(new Error('Closed case complexity is immutable'), { statusCode: 409 });
    await tx.replaceFactorSnapshot(caseId, result.factors, modelVersion, actorId, String(reason).trim());
    const updated = await tx.updateComplexity(caseId, { complexity_score: result.score,
      complexity_class: result.complexityClass, workload_units: result.workloadUnits,
      complexity_model_version: modelVersion, workload_model_version: modelVersion,
      complexity_coverage: 'FULL', updated_by: actorId });
    await tx.writeAudit({ entity_type: 'procurement_case', entity_id: caseId,
      action: 'COMPLEXITY_ASSESSED', actor_user_id: actorId, reason: String(reason).trim(),
      metadata: { model_version: modelVersion, factors: result.factors } });
    return updated;
  });
}

module.exports = { scoreFacts, assessComplexity, classify, MODEL_VERSION, CLASS_BANDS };