'use strict';

const { createConnectedP2PRepository } = require('../repositories/connectedP2PRepository');
const fs = require('fs');
const path = require('path');

const mockClient = () => {
  const queries = [];
  return {
    queries,
    query: jest.fn(async (sql, values) => {
      queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), values });
      return { rows: [{ amount: '0', quantity: '0' }], rowCount: 1 };
    }),
  };
};

describe('connected P2P repository checked-in schema contract', () => {
  test('SQL 006 permits nullable legacy requested items but rejects dangling references', () => {
    const migration = fs.readFileSync(path.join(__dirname, '../sql/manual/006_connected_procure_to_pay.sql'), 'utf8');
    expect(migration).toContain('ri.request_id IS NOT NULL AND r.id IS NULL');
    expect(migration).toContain("WHERE request_id IS NULL) THEN RAISE NOTICE");
    expect(migration).not.toContain("WHERE r.id IS NULL) THEN RAISE EXCEPTION 'Preflight: orphan requested_items.request_id rows'");
  });

  test('SQL 006 preserves supplier-less legacy POs but rejects dangling suppliers', () => {
    const migration = fs.readFileSync(path.join(__dirname, '../sql/manual/006_connected_procure_to_pay.sql'), 'utf8');
    expect(migration).toContain("purchase_orders WHERE supplier_id IS NULL) THEN RAISE NOTICE");
    expect(migration).toContain('po.supplier_id IS NOT NULL AND s.id IS NULL');
    expect(migration).not.toContain("purchase_orders WHERE supplier_id IS NULL) THEN RAISE EXCEPTION");
  });

  test('SQL 006 catalog-guards optional requested-item award fields', () => {
    const migration = fs.readFileSync(path.join(__dirname, '../sql/manual/006_connected_procure_to_pay.sql'), 'utf8');
    expect(migration).toContain("column_name IN ('supplier_name','unit_cost')");
    expect(migration).toContain("format('SELECT EXISTS (SELECT 1 FROM public.requested_items WHERE %I IS NOT NULL)', legacy_column)");
    expect(migration).not.toContain('FROM public.requested_items WHERE supplier_name IS NOT NULL OR unit_cost IS NOT NULL');
  });

  test('SQL 006 safely resumes when the compatible awards relation exists', () => {
    const migration = fs.readFileSync(path.join(__dirname, '../sql/manual/006_connected_procure_to_pay.sql'), 'utf8');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.procurement_awards');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS procurement_awards_request_item_idx');
    expect(migration).toContain("existing procurement_awards relation is incompatible with SQL 006");
    expect(migration).toContain('GROUP BY table_name HAVING count(*)=15');
    expect(migration).not.toMatch(/CREATE TABLE public\.procurement_awards/);
  });

  test('award insert includes SQL 009 Product and Catalog traceability', async () => {
    const client = mockClient();
    const repository = createConnectedP2PRepository(client);
    const award = { request_id: 1, request_item_id: 2, supplier_id: 3, approved_product_id: 20, supplier_catalog_item_id: 30, awarded_quantity: '4', unit_price: '5.25', currency: 'USD', source_type: 'QUOTATION', source_id: 6, selection_reason: 'best compliant offer', actor_id: 7, idempotency_key: 'award-8', payload_fingerprint: 'a'.repeat(64) };
    await repository.insertAward(award);
    const { sql, values } = client.queries[0];
    expect(sql).toContain('(request_id,request_item_id,supplier_id,approved_product_id,supplier_catalog_item_id,awarded_quantity,unit_price,currency,source_type,source_id,selection_reason,actor_id,idempotency_key,payload_fingerprint,status)');
    expect(sql).toContain("$14,'ACTIVE'");
    expect(sql).not.toContain('created_by');
    expect(values).toEqual([1, 2, 3, 20, 30, '4', '5.25', 'USD', 'QUOTATION', 6, 'best compliant offer', 7, 'award-8', 'a'.repeat(64)]);
    const migration = fs.readFileSync(path.join(__dirname, '../sql/manual/006_connected_procure_to_pay.sql'), 'utf8');
    const definition = migration.match(/CREATE TABLE(?: IF NOT EXISTS)? public\.procurement_awards \(([\s\S]*?)\n\);/)[1];
    const insertColumns = sql.match(/procurement_awards \(([^)]+)\)/)[1].split(',').map(value => value.trim());
    const phase5 = fs.readFileSync(path.join(__dirname, '../sql/manual/009_phase5a2_uom_authority.sql'), 'utf8');
    for (const column of insertColumns) expect(`${definition}\n${phase5}`).toMatch(new RegExp(`\\b${column}\\b`));
    for (const required of ['selection_reason', 'actor_id', 'payload_fingerprint']) {
      expect(insertColumns).toContain(required);
      expect(values[insertColumns.indexOf(required)]).toBeTruthy();
    }
  });

  test('governed award snapshot prefers immutable request descriptions before product fallback', async () => {
    const client = mockClient();
    const repository = createConnectedP2PRepository(client);
    await repository.loadAwardUomSnapshot(8);
    const { sql, values } = client.queries[0];
    expect(sql).toContain('JOIN requested_items ri ON ri.id=a.request_item_id');
    expect(sql).toContain('COALESCE(ri.canonical_description_snapshot,ri.item_name_snapshot,ri.item_name,p.product_name,p.product_description) item_name');
    expect(values).toEqual([8]);
  });

  test('receipt operations execute against goods_receipt_items and its real quantity columns', async () => {
    const client = mockClient();
    const repository = createConnectedP2PRepository(client);
    await repository.lockGoodsReceiptOperation('receipt-1');
    await repository.loadCumulativeAcceptedReceipts(4);
    await repository.insertGoodsReceiptLine({ goods_receipt_id: 1, purchase_order_item_id: 4, requested_item_id: 2, item_name: 'Gloves', ordered_quantity: '10', accepted_quantity: '4', unit_price: '2' });
    const executed = client.queries.map(({ sql }) => sql).join('\n');
    expect(executed).toContain('goods_receipt_items');
    expect(executed).toContain('received_quantity');
    expect(executed).toContain('received_quantity-gri.damaged_quantity-gri.short_quantity');
    expect(executed).toContain('pg_advisory_xact_lock');
    expect(executed).not.toContain('goods_receipt_lines');
  });

  test('invoice operations execute against invoice_items only', async () => {
    const client = mockClient();
    const repository = createConnectedP2PRepository(client);
    await repository.insertSupplierInvoiceLine({ supplier_invoice_id: 1, purchase_order_item_id: 2, requested_item_id: 3, description: 'Service', quantity: '1', unit_price: '5', line_total: '5' });
    await repository.loadPriorValidInvoices(8, 9);
    const executed = client.queries.map(({ sql }) => sql).join('\n');
    expect(executed).toContain('invoice_items');
    expect(executed).not.toContain('supplier_invoice_items');
  });

  test('budget operations execute with stage/state and never legacy column names', async () => {
    const client = mockClient();
    const repository = createConnectedP2PRepository(client);
    await repository.sumActiveEncumbrances(1);
    await repository.insertEncumbrance({ request_id: 2, budget_envelope_id: 1, purchase_order_id: 3, amount: '12.00', currency: 'USD', idempotency_key: 'po-release:3', actor_id: 4 });
    await repository.releaseCommitment(7);
    const executed = client.queries.map(({ sql }) => sql).join('\n');
    expect(executed).toContain("stage='encumbrance'");
    expect(executed).toContain("state='ACTIVE'");
    expect(executed).not.toMatch(/commitment_type|\bstatus\s*=\s*'ACTIVE'/);
  });
});