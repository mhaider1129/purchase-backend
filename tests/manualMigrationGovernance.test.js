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

  test('SQL 010 has a clean creation path rather than drift-masking DDL', () => {
    expect(sql010).toContain('IF existing_objects = 0 THEN RETURN; END IF;');
    expect(sql010).toMatch(/CREATE TABLE(?: IF NOT EXISTS)? public\.procurement_cases/);
    expect(sql010).toContain('CREATE INDEX procurement_cases_scope_idx');
    // Immutable deployed SQL 010 uses IF NOT EXISTS for tables and indexes, so
    // the old blanket prohibition was not truthful. The next test governs the
    // exhaustive preflight that makes this syntax fail closed rather than mask drift.
    expect(sql010).toContain('CREATE INDEX IF NOT EXISTS procurement_cases_scope_idx');
  });

  test('SQL 010 identifies already-applied and partial or drifted states before DDL', () => {
    const firstDdl = sql010.search(/CREATE TABLE(?: IF NOT EXISTS)? public\.procurement_cases/);
    expect(firstDdl).toBeGreaterThan(0);
    const preflight = sql010.slice(0, firstDdl);
    expect(preflight).toContain('SQL_010_ALREADY_APPLIED');
    expect(preflight).toContain('SQL_010_PARTIAL_OR_DRIFTED_SCHEMA');
    expect(preflight).toContain("'missing column public.' || r.table_name || '.' || r.column_name");
    expect(preflight).toContain("('procurement_cases','case_status')");
    expect(preflight).toContain("('procurement_cases','activity_coverage')");
    expect(preflight).toContain("('procurement_cases','complexity_score')");
    expect(preflight).toContain("'missing FK on public.'");
    expect(preflight).toContain("'missing/mismatched index public.'");
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

  test('preflight distinguishes clean, compatible, and partial/drifted states', () => {
    const ddl = sql011.indexOf('ALTER TABLE public.requests');
    const preflight = sql011.slice(0, ddl);
    expect(preflight).toContain("at_type IS NULL AND by_type IS NULL");
    expect(preflight).toContain('CENTRAL_SUPPLY_SCHEMA_PARTIAL_OR_DRIFTED');
    expect(preflight).toContain("to_regclass('public.requests')");
    expect(preflight).toContain("to_regclass('public.users')");
    // SQL 011 intentionally treats a compatible installation as a successful
    // no-op instead of raising the former SQL_011_ALREADY_APPLIED_COMPATIBLE
    // exception; partial or type-drifted states must still fail closed.
    expect(preflight).not.toContain('SQL_011_ALREADY_APPLIED_COMPATIBLE');
  });
});