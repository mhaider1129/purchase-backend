'use strict';
const submitInvoice = async ({ repository, invoice }) => repository.lockSupplierInvoiceKey(invoice.supplier_id, invoice.invoice_number, async () => {
  if (!invoice.supplier_id || !invoice.purchase_order_id || !invoice.currency || !invoice.invoice_number || !invoice.invoice_date || !invoice.lines?.length) throw Object.assign(new Error('Supplier, purchase order, currency, invoice number/date and lines are required'), { code: 'INVALID_INVOICE' });
  const retry = invoice.idempotency_key && await repository.findByIdempotencyKey(invoice.idempotency_key);
  if (retry) return retry;
  if (await repository.findBySupplierAndNumber(invoice.supplier_id, invoice.invoice_number)) throw Object.assign(new Error('Duplicate supplier invoice'), { code: 'DUPLICATE_INVOICE' });
  const purchaseOrder = await repository.getPurchaseOrder(invoice.purchase_order_id);
  if (!purchaseOrder || String(purchaseOrder.supplier_id) !== String(invoice.supplier_id)) throw Object.assign(new Error('Invoice supplier does not match purchase order supplier'), { code: 'INVOICE_SUPPLIER_MISMATCH' });
  return repository.insert({ ...invoice, status: 'SUBMITTED' });
});
const assertPayable = (invoice) => { if (invoice.status !== 'APPROVED_FOR_PAYMENT') throw Object.assign(new Error('Invoice is not approved for payment'), { code: 'INVOICE_NOT_PAYABLE' }); };
module.exports = { submitInvoice, assertPayable };