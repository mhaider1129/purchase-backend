'use strict';

const { validateAccountingEntry } = require('../services/accountingEntryValidation');

const entry = (amount = '120.00') => ({
  totalAmount: amount,
  lines: [{ debit_amount: amount }, { credit_amount: amount }],
});

describe('accounting amounts and balancing', () => {
  test('sums split decimal lines exactly and accepts insignificant trailing zeroes', () => {
    expect(validateAccountingEntry({ totalAmount: '0.3000', lines: [
      { debit_amount: '0.10' }, { debit_amount: '0.2000' }, { credit_amount: '0.30' },
    ] })).toEqual({ debit: '0.30', credit: '0.30' });
  });

  test('preserves the maximum stored amount without floating-point rounding', () => {
    expect(validateAccountingEntry({ totalAmount: '999999999999.99', lines: [
      { debit_amount: '999999999999.98' }, { debit_amount: '0.01' },
      { credit_amount: '999999999999.99' },
    ] })).toEqual({ debit: '999999999999.99', credit: '999999999999.99' });
  });

  test.each([NaN, Infinity, true, {}, '', '1e2', '-10', '-0.01'])('rejects invalid or negative amounts (%s)', amount => {
    expect(() => validateAccountingEntry(entry(amount))).toThrow(expect.objectContaining({ code: 'INVALID_ACCOUNTING_AMOUNT' }));
  });

  test.each(['0.004', '0.005', '1.00001', 0.1 + 0.2])('rejects amounts requiring silent storage rounding (%s)', amount => {
    expect(() => validateAccountingEntry(entry(amount))).toThrow(expect.objectContaining({ code: 'ACCOUNTING_AMOUNT_PRECISION' }));
  });

  test('rejects amounts outside NUMERIC(14,2)', () => {
    expect(() => validateAccountingEntry(entry('1000000000000'))).toThrow(expect.objectContaining({ code: 'ACCOUNTING_AMOUNT_OUT_OF_RANGE' }));
  });

  test('checks each line before aggregating so small debits cannot disappear on storage', () => {
    expect(() => validateAccountingEntry({ totalAmount: '0.01', lines: [
      { debit_amount: '0.004' }, { debit_amount: '0.004' }, { credit_amount: '0.01' },
    ] })).toThrow(expect.objectContaining({ code: 'ACCOUNTING_AMOUNT_PRECISION' }));
  });

  test.each([
    { debit_amount: '10', credit_amount: '5' }, {}, null, [], 'invalid',
  ])('rejects malformed, empty or two-sided lines (%s)', line => {
    expect(() => validateAccountingEntry({ ...entry(), lines: [line, { credit_amount: '120' }] }))
      .toThrow(expect.objectContaining({ code: 'INVALID_ACCOUNTING_LINE' }));
  });

  test.each([[], null, {}])('requires accounting lines (%s)', lines => {
    expect(() => validateAccountingEntry({ ...entry(), lines })).toThrow(expect.objectContaining({ code: 'ACCOUNTING_LINES_REQUIRED' }));
  });

  test('rejects zero-value documents', () => {
    expect(() => validateAccountingEntry(entry('0'))).toThrow(expect.objectContaining({ code: 'INVALID_ACCOUNTING_AMOUNT' }));
  });

  test('reports an unbalanced voucher separately from a balanced source-total mismatch', () => {
    expect(() => validateAccountingEntry({ totalAmount: '120', lines: [{ debit_amount: '120' }, { credit_amount: '119.99' }] }))
      .toThrow(expect.objectContaining({ code: 'UNBALANCED_VOUCHER' }));
    expect(() => validateAccountingEntry({ ...entry('119.99'), totalAmount: '120' }))
      .toThrow(expect.objectContaining({ code: 'VOUCHER_INVOICE_MISMATCH' }));
  });
});
