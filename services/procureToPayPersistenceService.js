'use strict';

const createHttpError = require('../utils/httpError');

// Compatibility exports intentionally fail closed.  All live receipt and invoice
// creation is owned by goodsReceiptService and supplierInvoiceService respectively.
const insertGoodsReceipt = async () => {
  throw createHttpError(410, 'Legacy receipt writer removed; use goodsReceiptService');
};

const insertSupplierInvoice = async () => {
  throw createHttpError(410, 'Legacy invoice writer removed; use supplierInvoiceService');
};

module.exports = { insertGoodsReceipt, insertSupplierInvoice };