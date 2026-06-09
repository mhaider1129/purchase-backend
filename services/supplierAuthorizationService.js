const pool = require('../config/db');

const normalizeText = value => (typeof value === 'string' ? value.trim() : '');

const checkSupplierAuthorizationForCategory = async (supplierId, categoryOrBrand, client = pool) => {
  const parsedSupplierId = Number(supplierId);
  const searchValue = normalizeText(categoryOrBrand).toLowerCase();

  if (!Number.isInteger(parsedSupplierId) || parsedSupplierId <= 0 || !searchValue) {
    return false;
  }

  const { rows } = await client.query(
    `SELECT 1
       FROM supplier_principals
      WHERE supplier_id = $1
        AND is_active = TRUE
        AND authorization_status = 'Verified'
        AND (
          authorization_expiry_date IS NULL
          OR authorization_expiry_date >= CURRENT_DATE
        )
        AND (
          EXISTS (
            SELECT 1
              FROM unnest(COALESCE(authorized_categories, ARRAY[]::TEXT[])) AS category(value)
             WHERE LOWER(category.value) = $2
          )
          OR EXISTS (
            SELECT 1
              FROM unnest(COALESCE(authorized_brands, ARRAY[]::TEXT[])) AS brand(value)
             WHERE LOWER(brand.value) = $2
          )
        )
      LIMIT 1`,
    [parsedSupplierId, searchValue]
  );

  return rows.length > 0;
};

module.exports = {
  checkSupplierAuthorizationForCategory,
};