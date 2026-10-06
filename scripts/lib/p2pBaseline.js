'use strict';

// Diagnostic queries only. Do not import app.js, config/db, or runtime ensure helpers.
const DEVELOPMENT_PROJECT_REF = 'bcvfosxcyvarieiinovo';
const TABLES = [
  'requests', 'requested_items', 'requested_item_financials', 'approvals',
  'approval_route_snapshots', 'approval_route_snapshot_steps', 'approval_policies',
  'approval_policy_versions', 'organization_units', 'organization_positions',
  'suppliers', 'generic_items', 'approved_products', 'supplier_catalog_items',
  'item_uom', 'item_uom_conversions', 'stock_items', 'warehouses',
  'rfx_events', 'rfx_responses', 'rfx_response_items', 'procurement_awards',
  'purchase_orders', 'purchase_order_items', 'goods_receipts', 'goods_receipt_items',
  'supplier_invoices', 'invoice_items', 'invoice_match_results',
  'invoice_match_override_decisions', 'ap_vouchers', 'ap_voucher_lines',
  'finance_postings', 'ap_payables', 'payment_records', 'payment_allocations',
  'budget_envelopes', 'commitment_ledger', 'contracts', 'contract_items',
  'contract_invoices', 'contract_payments', 'contract_consumption',
  'journal_entries', 'journal_entry_lines', 'gl_postings', 'gl_posting_lines',
  'warehouse_stock_levels', 'inventory_transactions', 'inventory_transaction_allocations',
  'document_flow_links', 'audit_logs', 'notification_outbox', 'pgmigrations',
];

function assertDevelopmentTarget(env) {
  let rest, db;
  try { rest = new URL(env.SUPABASE_URL); db = new URL(env.DATABASE_URL); }
  catch (_) { throw Object.assign(new Error('Supabase and PostgreSQL development bindings are required'), { code: 'BASELINE_BINDINGS_MISSING' }); }
  const direct = db.hostname === `db.${DEVELOPMENT_PROJECT_REF}.supabase.co`
    && decodeURIComponent(db.username) === 'postgres';
  const pooled = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(db.hostname)
    && decodeURIComponent(db.username) === `postgres.${DEVELOPMENT_PROJECT_REF}`;
  if (rest.protocol !== 'https:' || rest.hostname !== `${DEVELOPMENT_PROJECT_REF}.supabase.co`
    || rest.username || rest.password || rest.port || rest.search || rest.hash
    || !['', '/'].includes(rest.pathname)
    || !['postgres:', 'postgresql:'].includes(db.protocol) || (!direct && !pooled)
    || !['', '5432', '6543'].includes(db.port) || db.pathname !== '/postgres'
    || db.search || db.hash) {
    throw Object.assign(new Error('Bindings do not identify the approved development project; no connection attempted'), { code: 'BASELINE_PROJECT_MISMATCH' });
  }
  return { projectRef: DEVELOPMENT_PROJECT_REF, restOrigin: rest.origin };
}

const CATALOG_QUERIES = {
  relations: `SELECT c.relname table_name, c.relkind relation_kind, c.relrowsecurity rls_enabled,
    c.relforcerowsecurity rls_forced, c.reloptions, pg_get_userbyid(c.relowner) owner,
    has_table_privilege(c.oid,'SELECT') can_select,
    has_table_privilege(c.oid,'INSERT') can_insert, has_table_privilege(c.oid,'UPDATE') can_update
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relkind IN ('r','p','v','m') ORDER BY c.relname`,
  columns: `SELECT c.relname table_name, a.attname column_name,
    format_type(a.atttypid,a.atttypmod) data_type, a.attnotnull not_null,
    a.attidentity identity_kind, a.attgenerated generated_kind
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.relname,a.attnum`,
  constraints: `SELECT c.relname table_name, k.conname constraint_name, k.contype constraint_type,
    k.convalidated validated, k.condeferrable deferrable, pg_get_constraintdef(k.oid) definition
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,k.conname`,
  indexes: `SELECT tablename table_name,indexname index_name,indexdef definition
    FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,indexname`,
  triggers: `SELECT c.relname table_name,t.tgname trigger_name,t.tgenabled enabled,
    pg_get_triggerdef(t.oid) definition,p.prosecdef security_definer
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal
    ORDER BY c.relname,t.tgname`,
  policies: `SELECT tablename table_name,policyname policy_name,permissive,roles,cmd,qual,with_check
    FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,policyname`,
  grants: `SELECT table_name,grantee,privilege_type,is_grantable FROM information_schema.table_privileges
    WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY table_name,grantee,privilege_type`,
  migration_ledgers: `SELECT n.nspname schema_name,c.relname table_name,a.attname column_name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE ((n.nspname='supabase_migrations' AND c.relname='schema_migrations')
      OR (n.nspname='public' AND c.relname='pgmigrations')) AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname,c.relname,a.attnum`,
};

// Results are counts of candidates, never supplier bill numbers or person/record IDs.
const CHECKS = [
  {
    id: 'supplier_bill_duplicate_groups',
    requires: { supplier_invoices: ['supplier_id', 'invoice_number'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM (SELECT supplier_id,lower(btrim(invoice_number))
      FROM public.supplier_invoices WHERE supplier_id IS NOT NULL AND nullif(btrim(invoice_number),'') IS NOT NULL
      GROUP BY supplier_id,lower(btrim(invoice_number)) HAVING COUNT(*)>1) x`,
  },
  {
    id: 'cross_source_supplier_bill_candidates',
    requires: { supplier_invoices: ['supplier_id', 'invoice_number'], contract_invoices: ['supplier_id', 'invoice_number'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM (SELECT DISTINCT s.supplier_id,lower(btrim(s.invoice_number))
      FROM public.supplier_invoices s JOIN public.contract_invoices c ON c.supplier_id=s.supplier_id
      AND lower(btrim(c.invoice_number))=lower(btrim(s.invoice_number)) WHERE nullif(btrim(s.invoice_number),'') IS NOT NULL) x`,
  },
  {
    id: 'invoice_po_identity_mismatch',
    requires: { supplier_invoices: ['purchase_order_id', 'request_id', 'supplier_id', 'currency'], purchase_orders: ['id', 'request_id', 'supplier_id', 'currency'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM public.supplier_invoices s LEFT JOIN public.purchase_orders p ON p.id=s.purchase_order_id
      WHERE p.id IS NULL OR s.request_id IS DISTINCT FROM p.request_id OR s.supplier_id IS DISTINCT FROM p.supplier_id
      OR upper(s.currency) IS DISTINCT FROM upper(p.currency)`,
  },
  {
    id: 'unlinked_purchase_orders',
    requires: { purchase_orders: ['request_id', 'supplier_id'], requests: ['id'], suppliers: ['id'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM public.purchase_orders p LEFT JOIN public.requests r ON r.id=p.request_id
      LEFT JOIN public.suppliers s ON s.id=p.supplier_id WHERE r.id IS NULL OR s.id IS NULL`,
  },
  {
    id: 'repeated_invoice_po_line_groups',
    requires: { invoice_items: ['supplier_invoice_id', 'purchase_order_item_id'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM (SELECT supplier_invoice_id,purchase_order_item_id FROM public.invoice_items
      WHERE purchase_order_item_id IS NOT NULL GROUP BY supplier_invoice_id,purchase_order_item_id HAVING COUNT(*)>1) x`,
  },
  {
    id: 'invoice_line_link_mismatch',
    requires: { invoice_items: ['supplier_invoice_id', 'purchase_order_item_id', 'requested_item_id'], supplier_invoices: ['id', 'purchase_order_id'], purchase_order_items: ['id', 'purchase_order_id', 'requested_item_id'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM public.invoice_items l LEFT JOIN public.supplier_invoices s ON s.id=l.supplier_invoice_id
      LEFT JOIN public.purchase_order_items p ON p.id=l.purchase_order_item_id WHERE s.id IS NULL OR p.id IS NULL
      OR s.purchase_order_id IS DISTINCT FROM p.purchase_order_id OR l.requested_item_id IS DISTINCT FROM p.requested_item_id`,
  },
  {
    id: 'payables_without_posted_authority',
    requires: { ap_payables: ['ap_voucher_id', 'supplier_invoice_id', 'request_id', 'supplier_id', 'currency'], ap_vouchers: ['id', 'voucher_status', 'supplier_invoice_id', 'request_id'], supplier_invoices: ['id', 'request_id', 'supplier_id', 'currency'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM public.ap_payables p LEFT JOIN public.ap_vouchers v ON v.id=p.ap_voucher_id
      LEFT JOIN public.supplier_invoices s ON s.id=p.supplier_invoice_id WHERE v.id IS NULL OR s.id IS NULL
      OR lower(v.voucher_status) IS DISTINCT FROM 'posted' OR v.supplier_invoice_id IS DISTINCT FROM s.id
      OR v.request_id IS DISTINCT FROM p.request_id OR s.request_id IS DISTINCT FROM p.request_id
      OR p.supplier_id IS DISTINCT FROM s.supplier_id OR upper(p.currency) IS DISTINCT FROM upper(s.currency)`,
  },
  {
    id: 'duplicate_active_payable_groups',
    requires: { ap_payables: ['supplier_invoice_id', 'payable_status'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM (SELECT supplier_invoice_id FROM public.ap_payables
      WHERE payable_status IN ('OPEN','PARTIALLY_PAID') GROUP BY supplier_invoice_id HAVING COUNT(*)>1) x`,
  },
  {
    id: 'payable_balance_or_overpayment_candidates',
    requires: { ap_payables: ['id', 'invoice_total', 'open_balance'], payment_allocations: ['ap_payable_id', 'payment_record_id', 'amount'], payment_records: ['id', 'payment_status'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM public.ap_payables p LEFT JOIN LATERAL (SELECT COALESCE(SUM(a.amount),0) paid
      FROM public.payment_allocations a JOIN public.payment_records r ON r.id=a.payment_record_id
      WHERE a.ap_payable_id=p.id AND r.payment_status='paid') paid ON TRUE WHERE paid.paid>p.invoice_total
      OR p.invoice_total IS NULL OR p.open_balance IS DISTINCT FROM (p.invoice_total-paid.paid)`,
  },
  {
    id: 'paid_records_without_allocations',
    requires: { payment_records: ['id', 'payment_status'], payment_allocations: ['payment_record_id'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM public.payment_records p WHERE p.payment_status='paid'
      AND NOT EXISTS(SELECT 1 FROM public.payment_allocations a WHERE a.payment_record_id=p.id)`,
  },
  {
    id: 'payment_allocation_identity_or_currency_mismatch',
    requires: { payment_allocations: ['ap_payable_id', 'payment_record_id', 'amount'], ap_payables: ['id', 'supplier_invoice_id', 'ap_voucher_id', 'request_id', 'currency'], payment_records: ['id', 'supplier_invoice_id', 'ap_voucher_id', 'request_id', 'currency'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM public.payment_allocations a LEFT JOIN public.ap_payables p ON p.id=a.ap_payable_id
      LEFT JOIN public.payment_records r ON r.id=a.payment_record_id WHERE p.id IS NULL OR r.id IS NULL OR a.amount<=0 OR a.amount IS NULL
      OR p.supplier_invoice_id IS DISTINCT FROM r.supplier_invoice_id OR p.ap_voucher_id IS DISTINCT FROM r.ap_voucher_id
      OR p.request_id IS DISTINCT FROM r.request_id OR upper(p.currency) IS DISTINCT FROM upper(r.currency)`,
  },
  {
    id: 'paid_record_allocation_total_mismatch',
    requires: { payment_records: ['id', 'payment_status', 'amount_paid'], payment_allocations: ['payment_record_id', 'amount'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM public.payment_records r LEFT JOIN LATERAL
      (SELECT COALESCE(SUM(a.amount),0) allocated FROM public.payment_allocations a WHERE a.payment_record_id=r.id) x ON TRUE
      WHERE r.payment_status='paid' AND r.amount_paid IS DISTINCT FROM x.allocated`,
  },
  {
    id: 'contract_paid_without_invoice',
    requires: { contract_payments: ['status', 'invoice_id'], contract_invoices: ['id'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM public.contract_payments p LEFT JOIN public.contract_invoices i ON i.id=p.invoice_id
      WHERE p.status='paid' AND i.id IS NULL`,
  },
  {
    id: 'contract_paid_currency_or_contract_mismatch',
    requires: { contract_payments: ['status', 'invoice_id', 'contract_id', 'currency', 'amount'], contract_invoices: ['id', 'contract_id', 'currency'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM public.contract_payments p JOIN public.contract_invoices i ON i.id=p.invoice_id
      WHERE p.status='paid' AND (p.contract_id IS DISTINCT FROM i.contract_id
        OR upper(p.currency) IS DISTINCT FROM upper(i.currency) OR p.amount<=0 OR p.amount IS NULL)`,
  },
  {
    id: 'contract_invoice_overpayment_candidates',
    requires: { contract_invoices: ['id', 'currency', 'net_payable_amount'], contract_payments: ['invoice_id', 'currency', 'status', 'amount'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM public.contract_invoices i JOIN LATERAL
      (SELECT SUM(p.amount) paid FROM public.contract_payments p WHERE p.invoice_id=i.id AND p.status='paid'
        AND upper(p.currency)=upper(i.currency)) p ON TRUE WHERE p.paid>i.net_payable_amount`,
  },
  {
    id: 'contract_header_paid_projection_candidates',
    requires: { contracts: ['id', 'amount_paid', 'currency'], contract_payments: ['contract_id', 'status', 'amount', 'currency'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM public.contracts c LEFT JOIN LATERAL
      (SELECT COALESCE(SUM(p.amount),0) paid FROM public.contract_payments p WHERE p.contract_id=c.id AND p.status='paid'
        AND upper(p.currency)=upper(c.currency)) p ON TRUE
      WHERE c.amount_paid IS DISTINCT FROM p.paid`,
  },
  {
    id: 'stock_generic_ambiguity_groups',
    requires: { stock_items: ['generic_item_id'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM (SELECT generic_item_id FROM public.stock_items WHERE generic_item_id IS NOT NULL
      GROUP BY generic_item_id HAVING COUNT(*)>1) x`,
  },
  {
    id: 'receipt_uom_or_quantity_candidates',
    requires: { goods_receipt_items: ['source_uom', 'base_uom', 'conversion_factor', 'received_quantity', 'damaged_quantity', 'short_quantity'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM public.goods_receipt_items WHERE nullif(btrim(source_uom),'') IS NULL
      OR nullif(btrim(base_uom),'') IS NULL OR conversion_factor IS NULL OR conversion_factor<=0 OR received_quantity IS NULL
      OR damaged_quantity IS NULL OR short_quantity IS NULL OR received_quantity<0 OR damaged_quantity<0 OR short_quantity<0
      OR received_quantity-damaged_quantity-short_quantity<0`,
  },
  {
    id: 'po_maker_approver_same_actor',
    requires: { purchase_orders: ['created_by', 'approved_by'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM public.purchase_orders WHERE approved_by IS NOT NULL AND created_by=approved_by`,
  },
  {
    id: 'journal_duplicate_source_groups',
    requires: { journal_entries: ['source_type', 'source_id', 'journal_type', 'currency'] },
    sql: `SELECT COUNT(*)::text candidate_count FROM (SELECT source_type,source_id,journal_type,currency FROM public.journal_entries
      WHERE source_type IS NOT NULL AND source_id IS NOT NULL GROUP BY source_type,source_id,journal_type,currency HAVING COUNT(*)>1) x`,
  },
];

function missingColumns(columns, requires) {
  const present = new Set(columns.map(c => `${c.table_name}.${c.column_name}`));
  return Object.entries(requires).flatMap(([table, names]) => names
    .filter(name => !present.has(`${table}.${name}`)).map(name => `${table}.${name}`));
}

async function collectBaseline(client) {
  let started = false;
  const report = { kind: 'p2p-development-baseline', captured_at: new Date().toISOString(),
    evidence: 'postgres_catalog_and_visible_row_counts', schema: {}, row_counts: {}, checks: {}, migration_history: {},
    limitations: ['Counts are candidates, not proof of a duplicate payment or loss.',
      'Visibility is limited to the connecting role; RLS can hide rows.',
      'Manual SQL files are not proof of deployment; absent ledger entries are not proof of absence.',
      'No records, balances, policies, roles, constraints or migration state are changed.'] };
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    started = true;
    const context = await client.query(`SELECT current_user database_role,current_database() database_name,
      current_setting('server_version') server_version,current_setting('transaction_read_only') transaction_read_only,
      current_setting('row_security') row_security,r.rolsuper superuser,r.rolbypassrls bypass_rls
      FROM pg_roles r WHERE r.rolname=current_user`);
    if (context.rows[0]?.transaction_read_only !== 'on') {
      throw Object.assign(new Error('A read-only transaction is required'), { code: 'BASELINE_NOT_READ_ONLY' });
    }
    report.connection_context = context.rows[0];
    for (const [name, sql] of Object.entries(CATALOG_QUERIES)) {
      // The same exclusive Client executes every query in the same snapshot.
      report.schema[name] = (await client.query(sql, sql.includes('$1') ? [TABLES] : [])).rows;
    }
    report.missing_relations = TABLES.filter(table => !report.schema.relations.some(r => r.table_name === table));
    const scan = async (sql) => {
      await client.query('SAVEPOINT baseline_scan');
      try {
        const result = await client.query(sql);
        await client.query('RELEASE SAVEPOINT baseline_scan');
        return { status: 'measured', rows: result.rows };
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT baseline_scan');
        await client.query('RELEASE SAVEPOINT baseline_scan');
        return { status: 'unavailable', error_code: String(error.code || 'UNKNOWN').slice(0, 40) };
      }
    };
    for (const table of TABLES) {
      const relation = report.schema.relations.find(r => r.table_name === table);
      if (!relation || !['r', 'p'].includes(relation.relation_kind)) {
        report.row_counts[table] = { status: relation ? 'not_scanned_relation_kind' : 'missing_relation' };
      } else {
        // Identifier comes exclusively from the checked-in allowlist, never CLI input.
        report.row_counts[table] = await scan(`SELECT COUNT(*)::text row_count FROM public."${table}"`);
      }
    }
    for (const check of CHECKS) {
      const missing = missingColumns(report.schema.columns, check.requires);
      report.checks[check.id] = missing.length ? { status: 'unavailable', missing_columns: missing } : await scan(check.sql);
    }
    const ledgers = report.schema.migration_ledgers;
    for (const [name, schema, columns, sql] of [
      ['supabase', 'supabase_migrations', ['version'], 'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version'],
      ['node_pg_migrate', 'public', ['name', 'run_on'], 'SELECT name,run_on FROM public.pgmigrations ORDER BY run_on,name'],
    ]) {
      const table = name === 'supabase' ? 'schema_migrations' : 'pgmigrations';
      const present = columns.every(column => ledgers.some(c => c.schema_name === schema && c.table_name === table && c.column_name === column));
      report.migration_history[name] = present ? await scan(sql) : { status: 'unavailable', reason: 'ledger_not_visible_or_missing' };
    }
    // A completed capture is not a declaration that the application is safe or ready.
    report.capture_complete = !Object.values(report.checks).some(check => check.status !== 'measured')
      && !Object.values(report.row_counts).some(count => count.status !== 'measured');
    return report;
  } finally {
    if (started) await client.query('ROLLBACK');
  }
}

module.exports = { DEVELOPMENT_PROJECT_REF, TABLES, CATALOG_QUERIES, CHECKS, assertDevelopmentTarget, missingColumns, collectBaseline };
