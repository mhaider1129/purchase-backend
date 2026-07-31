const normalize = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐‑–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
function capture(text, pattern, transform = (value) => value) {
  const match = text.match(pattern);
  if (!match) return null;
  return { value: transform(match[1] ?? match[0]), fragment: match[0] };
}
function result(parserName, parserVersion, source, definitions, warnings = []) {
  const text = normalize(source);
  const attributes = {};
  const sourceFragments = {};
  const confidence = {};
  const normalizationRules = {};
  for (const [key, definition] of Object.entries(definitions)) {
    const found = definition.extract(text);
    if (!found) continue;
    attributes[key] = found.value;
    sourceFragments[key] = found.fragment;
    confidence[key] = definition.confidence ?? 0.9;
    normalizationRules[key] = definition.rule;
  }
  return {
    parser_name: parserName,
    parser_version: parserVersion,
    attributes,
    source_fragments: sourceFragments,
    confidence,
    normalization_rules: normalizationRules,
    warnings,
  };
}
module.exports = { normalize, capture, result };