const normalizeLegacyStockItemName = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("und");

const findByNormalizedName = async (client, name) => {
  const identity = normalizeLegacyStockItemName(name);
  const result = await client.query(
    `SELECT id, name, unit
       FROM stock_items
      WHERE LOWER(REGEXP_REPLACE(TRIM(NORMALIZE(name, NFKC)), '\\s+', ' ', 'g')) = $1
      ORDER BY id ASC
      LIMIT 1`,
    [identity],
  );
  return result.rows[0] || null;
};

const insert = async (client, request) => {
  const result = await client.query(
    `INSERT INTO stock_items (name, description, unit, created_by, identity_source)
     VALUES ($1, $2, $3, $4, 'approved_exception')
     ON CONFLICT DO NOTHING
     RETURNING id, name, unit`,
    [request.name, request.description, request.unit, request.requested_by],
  );
  return result.rows[0] || null;
};

module.exports = { findByNormalizedName, insert, normalizeLegacyStockItemName };