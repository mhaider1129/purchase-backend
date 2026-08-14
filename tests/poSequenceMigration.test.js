'use strict';

const fs = require('fs');
const path = require('path');

describe('SQL 006 canonical PO sequence initialization', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sql/manual/006_connected_procure_to_pay.sql'), 'utf8');

  test('seeds from governed suffixes rather than row count or ids', () => {
    const seedBlock = sql.match(/DO \$sequence_seed\$[\s\S]*?END \$sequence_seed\$;/)[0];
    expect(seedBlock).toContain("substring(po_number FROM '^PO-[0-9]{4}-([0-9]{6})$')::BIGINT");
    expect(seedBlock).toContain('MAX(substring(po_number');
    expect(seedBlock).not.toMatch(/COUNT\s*\(\s*\*\s*\)/i);
    expect(seedBlock).not.toMatch(/MAX\s*\(\s*id\s*\)/i);
  });

  test.each([
    [['PO-2026-000137'], 137n],
    [['PO-2025-000900', 'PO-2026-000137'], 900n],
    [['CUSTOM-999999', 'PO-2026-000137', 'PO-2026-000005'], 137n],
  ])('governed pattern models migration maximum for %j', (numbers, expected) => {
    const suffixes = numbers.filter(value => /^PO-[0-9]{4}-[0-9]{6}$/.test(value)).map(value => BigInt(value.slice(8)));
    expect(suffixes.reduce((max, value) => value > max ? value : max, 0n)).toBe(expected);
  });

  test('empty governed data leaves the newly-created sequence at its safe first value', () => {
    expect(sql).toMatch(/IF governed_max IS NOT NULL THEN/);
    expect(sql).toContain('GREATEST(governed_max, (SELECT last_value FROM public.purchase_order_number_seq))');
  });
});