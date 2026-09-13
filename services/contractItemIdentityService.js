const createHttpError = require('../utils/httpError');

const positiveId = (value, field) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw createHttpError(400, `${field} must be a positive integer`);
  return id;
};

const validateContractItemIdentity = async (client, payload, contract, { required = false } = {}) => {
  const genericId = payload.generic_item_id ? positiveId(payload.generic_item_id, 'generic_item_id') : null;
  const productId = payload.approved_product_id ? positiveId(payload.approved_product_id, 'approved_product_id') : null;
  const catalogId = payload.supplier_catalog_item_id ? positiveId(payload.supplier_catalog_item_id, 'supplier_catalog_item_id') : null;
  const stockItemId = payload.item_id ? positiveId(payload.item_id, 'item_id') : null;
  if (required && !genericId) throw createHttpError(400, 'generic_item_id is required for new contract items');
  if (!genericId && (productId || catalogId)) throw createHttpError(400, 'Generic Item is required when Product or Supplier Catalog identity is selected');

  const generic = genericId ? (await client.query('SELECT id,generic_name,is_active FROM generic_items WHERE id=$1 FOR SHARE', [genericId])).rows[0] : null;
  if (genericId && (!generic || generic.is_active === false)) throw createHttpError(400, 'Generic Item is missing or inactive');
  const product = productId ? (await client.query("SELECT id,generic_item_id,product_name,manufacturer,is_active,approval_status FROM approved_products WHERE id=$1 FOR SHARE", [productId])).rows[0] : null;
  if (productId && (!product || product.is_active === false || product.approval_status !== 'approved')) throw createHttpError(400, 'Approved Product is missing, inactive, or unapproved');
  if (product && Number(product.generic_item_id) !== genericId) throw createHttpError(400, 'Approved Product does not belong to the selected Generic Item');
  const catalog = catalogId ? (await client.query('SELECT id,approved_product_id,supplier_id,supplier_description,is_active,is_approved_supplier FROM supplier_catalog_items WHERE id=$1 FOR SHARE', [catalogId])).rows[0] : null;
  if (catalogId && (!catalog || catalog.is_active === false || catalog.is_approved_supplier === false)) throw createHttpError(400, 'Supplier Catalog Item is missing, inactive, or unapproved');
  if (catalog && (!productId || Number(catalog.approved_product_id) !== productId)) throw createHttpError(400, 'Supplier Catalog Item does not belong to the selected Approved Product');
  if (catalog && contract.supplier_id && Number(catalog.supplier_id) !== Number(contract.supplier_id)) throw createHttpError(400, 'Supplier Catalog Item does not belong to the Contract supplier');
  const stockItem = stockItemId ? (await client.query('SELECT id,generic_item_id,approved_product_id FROM stock_items WHERE id=$1 FOR SHARE', [stockItemId])).rows[0] : null;
  if (stockItemId && !stockItem) throw createHttpError(400, 'Stock Item does not exist');
  if (stockItem && Number(stockItem.generic_item_id) !== genericId) throw createHttpError(400, 'Stock Item does not belong to the selected Generic Item');
  if (stockItem?.approved_product_id && (!productId || Number(stockItem.approved_product_id) !== productId)) throw createHttpError(400, 'Product-specific Stock Item requires its matching Approved Product');

  return {
    generic_item_id: genericId, approved_product_id: productId, supplier_catalog_item_id: catalogId,
    item_name: product?.product_name || catalog?.supplier_description || generic?.generic_name || null,
  };
};

module.exports = { validateContractItemIdentity };