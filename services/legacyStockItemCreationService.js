const createHttpError = require("../utils/httpError");
const legacyRepository = require("../repositories/legacyStockItemRepository");

const unresolvedConflict = () => {
  const error = createHttpError(409, "The conflicting stock item could not be loaded");
  error.code = "stock_item_conflict_unresolved";
  return error;
};

const createOrReuse = async (client, request) => {
  const existing = await legacyRepository.findByNormalizedName(client, request.name);
  if (existing) {
    return { item: existing, created: false, reused: true };
  }

  const inserted = await legacyRepository.insert(client, request);
  if (inserted) {
    return { item: inserted, created: true, reused: false };
  }

  // The same exact identity lookup is deliberately repeated after a concurrent
  // uniqueness conflict. It is never broadened to fuzzy or prefix matching.
  const concurrent = await legacyRepository.findByNormalizedName(
    client,
    request.name,
  );
  if (!concurrent) throw unresolvedConflict();
  return { item: concurrent, created: false, reused: true };
};

module.exports = { createOrReuse };