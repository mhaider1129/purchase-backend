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

module.exports = { scoreFacts, classify, MODEL_VERSION, CLASS_BANDS };