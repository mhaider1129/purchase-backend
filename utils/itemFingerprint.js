const crypto = require('crypto');

const normalizeText = (value, { caseSensitive = false } = {}) => {
  if (value == null) return null;
  const normalized = String(value)
    .normalize('NFKC')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;
  return caseSensitive ? normalized : normalized.toLowerCase();
};

const canonicalize = (value, options = {}) => {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toString()) : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const numeric = value.trim().match(/^-?(?:\d+\.?\d*|\.\d+)$/);
    if (numeric) return Number(value);
    return normalizeText(value, options);
  }
  if (Array.isArray(value)) {
    return value.map(entry => canonicalize(entry, options)).filter(entry => entry !== null);
  }
  if (typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      const normalized = canonicalize(value[key], options);
      if (normalized !== null && !(Array.isArray(normalized) && normalized.length === 0)) result[key] = normalized;
      return result;
    }, {});
  }
  return normalizeText(value, options);
};

const canonicalFingerprint = attributes => {
  const canonical = canonicalize(attributes);
  const content = JSON.stringify(canonical);
  return { canonical, content, hash: crypto.createHash('sha256').update(content).digest('hex') };
};

module.exports = { normalizeText, canonicalize, canonicalFingerprint };