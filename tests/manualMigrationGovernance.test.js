'use strict';

const fs = require('fs');
const path = require('path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const sql011 = read('sql/manual/011_central_supply_tracking.sql');

describe('manual migration governance', () => {
  const sql006 = read('sql/manual/006_connected_procure_to_pay.sql');
  const sql009 = read('sql/manual/009_phase5a2_uom_authority.sql');
  const sql010 = read('sql/manual/010_supply_chain_performance_foundation.sql');

  test('deployed SQL 006 does not claim the pending Goods Receipt conversion change', () => {
    expect(sql006).not.toMatch(/ALTER TABLE public\.goods_receipt_items\s+ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC/i);
  });

  test('pending SQL 009 owns the Goods Receipt conversion column and constraint', () => {
    expect(sql009).toContain('ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC;');
    expect(sql009).toContain('goods_receipt_items_positive_conversion');
    const preflight = sql009.slice(0, sql009.indexOf('BEGIN;'));
    expect(preflight).toContain("to_jsonb(g)->>'conversion_factor'");
    expect(preflight).not.toMatch(/goods_receipt_items[^;]*\bconversion_factor\s+IS\s+NULL/i);
  });

  test('SQL 010 has a rerunnable creation and legacy reconciliation path', () => {
    expect(sql010).toContain('CREATE TABLE IF NOT EXISTS public.procurement_cases');
    expect(sql010).toContain('CREATE INDEX IF NOT EXISTS procurement_cases_scope_idx');
    expect(sql010).toContain('ADD COLUMN IF NOT EXISTS activity_coverage');
    expect(sql010).toContain('ADD COLUMN IF NOT EXISTS assessment_reason');
    expect(sql010).toContain('Legacy assessment (reason unavailable)');
  });

  test('SQL 010 validates prerequisites without rejecting a recoverable partial deployment', () => {
    const preflight = sql010.slice(0, sql010.indexOf('CREATE TABLE IF NOT EXISTS public.procurement_cases'));
    expect(preflight).toContain('010 preflight missing: %');
    expect(preflight).not.toContain('SQL_010_PARTIAL_OR_DRIFTED_SCHEMA');
  });

  test('architecture policy marks deployed numbered migrations immutable', () => {
    const policy = read('docs/architecture/manual-migration-governance.md');
    expect(policy).toContain('Do not modify numbered migrations after production execution. Create a new forward migration.');
    expect(policy).toContain('001 through 006 are deployed');
    expect(policy).toContain('007 is diagnostic only');
    expect(policy).toContain('008, 009, and 010 are pending manual execution');
  });
});

describe('manual migration 011 governance', () => {
  test('owns both Central Supply columns and authenticated-user FK', () => {
    expect(sql011).toContain('ADD COLUMN IF NOT EXISTS sent_to_central_supply_at TIMESTAMPTZ');
    expect(sql011).toContain('ADD COLUMN IF NOT EXISTS sent_to_central_supply_by INTEGER');
    expect(sql011).toContain('REFERENCES public.users(id)');
  });

  test('preflight accepts recoverable partial states and rejects incompatible types', () => {
    const ddl = sql011.indexOf('ALTER TABLE public.requests');
    const preflight = sql011.slice(0, ddl);
    expect(preflight).toContain("at_type IS NULL AND by_type IS NULL");
    expect(preflight).toContain('SQL_011_ALREADY_APPLIED_COMPATIBLE');
    expect(preflight).toContain("RAISE NOTICE 'SQL_011_ALREADY_APPLIED_COMPATIBLE'");
    expect(preflight).toContain('CENTRAL_SUPPLY_SCHEMA_PARTIAL_OR_DRIFTED');
    expect(preflight).toContain("at_type IS NOT NULL AND at_type <> 'timestamp with time zone'");
    expect(preflight).toContain("to_regclass('public.requests')");
    expect(preflight).toContain("to_regclass('public.users')");
  });
});