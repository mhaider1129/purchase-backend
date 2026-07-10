const createHttpError = require('../utils/httpError');
const {
  getSupplierById,
  findOrCreateSupplierByName,
} = require('../controllers/suppliersController');

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const resolveSupplierReference = async (client, {
  supplierId = null,
  supplierName = null,
  requireSupplier = false,
}) => {
  let linkedSupplier = null;

  if (supplierId !== null && supplierId !== undefined && supplierId !== '') {
    linkedSupplier = await getSupplierById(client, supplierId);
    if (!linkedSupplier) {
      throw createHttpError(404, `Supplier with id ${supplierId} was not found`);
    }
  } else if (requireSupplier) {
    throw createHttpError(400, 'supplier_id is required');
  } else {
    const sanitizedSupplierName = normalizeText(supplierName);
    if (sanitizedSupplierName) {
      linkedSupplier = await findOrCreateSupplierByName(client, sanitizedSupplierName);
    }
  }

  if (requireSupplier && !linkedSupplier) {
    throw createHttpError(400, 'supplier_id is required');
  }

  return {
    supplierId: linkedSupplier?.id || null,
    supplierName: linkedSupplier?.name || normalizeText(supplierName) || null,
    supplier: linkedSupplier,
  };
};

module.exports = {
  resolveSupplierReference,
};