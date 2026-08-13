'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const approvedWriter = path.join(root, 'repositories', 'connectedP2PRepository.js');
const tables = [
  'purchase_orders', 'purchase_order_items', 'goods_receipts', 'goods_receipt_items',
  'supplier_invoices', 'invoice_items', 'invoice_match_results', 'ap_vouchers',
  'ap_payables', 'finance_postings', 'payment_records', 'payment_allocations',
  'commitment_ledger',
];

const productionFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const candidate = path.join(directory, entry.name);
  if (entry.isDirectory()) {
    if (['tests', 'node_modules', 'sql', 'docs'].includes(entry.name)) return [];
    return productionFiles(candidate);
  }
  return entry.isFile() && entry.name.endsWith('.js') ? [candidate] : [];
});

describe('Phase 4 canonical SQL writer boundary', () => {
  test.each(tables)('%s mutations are confined to the connected repository', (table) => {
    const mutation = new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE)\\s+${table}\\b`, 'i');
    const offenders = productionFiles(root)
      .filter((file) => file !== approvedWriter)
      .filter((file) => mutation.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });
});