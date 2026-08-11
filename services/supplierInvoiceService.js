'use strict';
const submitInvoice = async ({ repository, invoice }) => repository.lockSupplierInvoiceKey(invoice.supplier_id, invoice.invoice_number, async () => {
  const retry = invoice.idempotency_key && await repository.findByIdempotencyKey(invoice.idempotency_key);
  if (retry) return retry;
  if (await repository.findBySupplierAndNumber(invoice.supplier_id, invoice.invoice_number)) throw Object.assign(new Error('Duplicate supplier invoice'), { code: 'DUPLICATE_INVOICE' });
  if (!invoice.po_id || !invoice.currency || !invoice.lines?.length) throw Object.assign(new Error('Supplier, PO, currency and lines are required'), { code: 'INVALID_INVOICE' });
  return repository.insert({ ...invoice, status: 'SUBMITTED' });
});
const assertPayable = (invoice) => { if (invoice.status !== 'APPROVED_FOR_PAYMENT') throw Object.assign(new Error('Invoice is not approved for payment'), { code: 'INVOICE_NOT_PAYABLE' }); };
module.exports = { submitInvoice, assertPayable };