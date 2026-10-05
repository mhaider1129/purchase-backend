'use strict';

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const MAX_AMOUNT = 99999999999999n; // Existing accounting columns are NUMERIC(14,2).

// Validate the amounts that PostgreSQL will actually store. Do not round a
// document sum while allowing each individual line to round differently.
const parseAccountingAmount = (value, field) => {
  if (!['string', 'number'].includes(typeof value)) {
    throw fail(`${field} must be a non-negative decimal amount`, 'INVALID_ACCOUNTING_AMOUNT');
  }
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) {
    throw fail(`${field} must be a non-negative decimal amount`, 'INVALID_ACCOUNTING_AMOUNT');
  }
  const [whole, fraction = ''] = text.split('.');
  if (/[1-9]/.test(fraction.slice(2))) {
    throw fail(`${field} exceeds the accounting schema's two-decimal precision`, 'ACCOUNTING_AMOUNT_PRECISION');
  }
  const amount = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  if (amount > MAX_AMOUNT) {
    throw fail(`${field} exceeds the accounting schema's amount limit`, 'ACCOUNTING_AMOUNT_OUT_OF_RANGE');
  }
  return amount;
};

const formatAmount = amount => `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;

const validateAccountingEntry = ({
  lines,
  totalAmount,
  debitField = 'debit_amount',
  creditField = 'credit_amount',
  unbalancedCode = 'UNBALANCED_VOUCHER',
  mismatchCode = 'VOUCHER_INVOICE_MISMATCH',
  balanceErrorStatusCode = 400,
}) => {
  if (!Array.isArray(lines) || !lines.length) {
    throw fail('Accounting lines are required', 'ACCOUNTING_LINES_REQUIRED');
  }
  const total = parseAccountingAmount(totalAmount, 'Document total');
  if (total === 0n) throw fail('Document total must be positive', 'INVALID_ACCOUNTING_AMOUNT');
  let debit = 0n;
  let credit = 0n;
  for (const [index, line] of lines.entries()) {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      throw fail(`Accounting line ${index + 1} must be an object`, 'INVALID_ACCOUNTING_LINE');
    }
    const lineDebit = parseAccountingAmount(line[debitField] ?? '0', `Line ${index + 1} debit`);
    const lineCredit = parseAccountingAmount(line[creditField] ?? '0', `Line ${index + 1} credit`);
    if ((lineDebit === 0n) === (lineCredit === 0n)) {
      throw fail(`Accounting line ${index + 1} must have exactly one positive debit or credit`, 'INVALID_ACCOUNTING_LINE');
    }
    debit += lineDebit;
    credit += lineCredit;
  }
  if (debit !== credit) throw fail('Accounting debit and credit totals must balance', unbalancedCode, balanceErrorStatusCode);
  if (credit !== total) throw fail('Accounting totals must reconcile to the source document', mismatchCode, balanceErrorStatusCode);
  return { debit: formatAmount(debit), credit: formatAmount(credit) };
};

module.exports = { validateAccountingEntry };
