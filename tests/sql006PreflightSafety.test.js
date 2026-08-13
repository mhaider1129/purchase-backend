'use strict';

const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '../sql/manual/006_connected_procure_to_pay.sql'), 'utf8');
const preflight = sql.slice(0, sql.indexOf('-- requests/requested_items/suppliers/users'));
const staticallyBoundPreflight = preflight
  .replace(/\$preflight\$[\s\S]*?\$preflight\$/g, '')
  .replace(/--.*$/gm, '')
  .replace(/'(?:''|[^'])*'/g, "''");

test('SQL 006 preflight never statically binds commitment_ledger.ap_voucher_id', () => {
  expect(staticallyBoundPreflight).not.toMatch(/\bcl\.ap_voucher_id\b/);
  expect(preflight).toMatch(/column_name='ap_voucher_id'[\s\S]*column_name='ap_voucher_id'[\s\S]*EXECUTE \$preflight\$SELECT EXISTS/);
});

test('all preflight uses of self-introduced optional columns are catalog guarded and dynamic', () => {
  const guarded = [
    ['supplier_invoices', 'idempotency_key'],
    ['payment_records', 'idempotency_key'],
    ['goods_receipts', 'idempotency_key'],
    ['ap_payables', 'ap_voucher_id'],
    ['commitment_ledger', 'ap_voucher_id'],
    ['commitment_ledger', 'state'],
  ];
  for (const [table, column] of guarded) {
    expect(preflight).toContain(`table_name='${table}' AND column_name='${column}'`);
  }
  expect(preflight).not.toMatch(/AND EXISTS \(SELECT 1 FROM public\.commitment_ledger WHERE stage='encumbrance' AND state=/);
});

test('remaining self-introduced commitment and payment identity columns are not statically bound', () => {
  expect(staticallyBoundPreflight).not.toMatch(/\bcl\.(?:purchase_order_id|idempotency_key|parent_commitment_id|supplier_invoice_id|ap_voucher_id)\b/);
  expect(staticallyBoundPreflight).not.toMatch(/\bpr\.(?:idempotency_key|supplier_invoice_id|reversal_of_payment_id|payload_fingerprint|currency)\b/);
  expect(staticallyBoundPreflight).not.toMatch(/\bsi\.(?:normalized_invoice_number|idempotency_key|payload_fingerprint)\b/);
  expect(staticallyBoundPreflight).not.toMatch(/\bgr\.(?:idempotency_key|payload_fingerprint)\b/);
});