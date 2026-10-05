"use strict";
const createHttpError = require("../utils/httpError");
const fail = (code, message) =>
  Object.assign(createHttpError(409, message), { code });

async function resolveReceiptStockItem(client, identity) {
  const { generic_item_id, approved_product_id, base_uom_id, warehouse_id } =
    identity;
  if (!generic_item_id || !base_uom_id || !warehouse_id) {
    throw fail(
      "STOCK_IDENTITY_UNRESOLVED",
      "Receipt requires a resolved Generic Item, inventory UOM and warehouse",
    );
  }
  // Product-specific inventory must match the awarded Product. A deliberately
  // Generic-only mapped identity can receive Products under that Generic. If
  // both forms exist, the mapping must be resolved explicitly; no priority or
  // arbitrary first-row selection is allowed.
  const result = await client.query(
    `SELECT si.* FROM public.stock_items si
    JOIN public.warehouses w ON w.id=$4 AND w.is_active=TRUE
    WHERE si.generic_item_id=$1 AND si.inventory_uom_id=$3
      AND si.mapping_status IN ('mapped_generic','mapped_product')
      AND ((si.approved_product_id IS NOT DISTINCT FROM $2::bigint)
        OR (si.approved_product_id IS NULL AND si.mapping_status='mapped_generic'))
      AND (si.mapping_status<>'mapped_product' OR si.approved_product_id IS NOT NULL)
      AND EXISTS (SELECT 1 FROM public.warehouse_stock_levels levels
        WHERE levels.stock_item_id=si.id AND levels.warehouse_id=w.id)
    ORDER BY si.id FOR SHARE OF si`,
    [generic_item_id, approved_product_id || null, base_uom_id, warehouse_id],
  );
  if (!result.rows.length)
    throw fail(
      "STOCK_IDENTITY_NOT_FOUND",
      "No approved Stock Item matches the receipt identity and warehouse; use controlled mapping or Add to Inventory",
    );
  if (result.rows.length !== 1)
    throw fail(
      "STOCK_IDENTITY_AMBIGUOUS",
      "Multiple approved Stock Items match the receipt; resolve inventory mapping before receipt",
    );
  return result.rows[0];
}
module.exports = { resolveReceiptStockItem };
