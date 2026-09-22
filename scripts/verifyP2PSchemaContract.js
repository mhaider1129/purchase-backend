'use strict';

// Read-only deployment/startup gate. It deliberately uses catalog SELECTs only;
// schema changes remain owned by sql/manual/031_p2p_batch1_authority_hardening.sql.
const pool = require('../config/db');

const REQUIRED_COLUMNS = {
  purchase_orders: ['id', 'request_id', 'supplier_id'],
  supplier_invoices: ['id', 'request_id', 'supplier_id', 'purchase_order_id'],
  ap_payables: ['id', 'request_id', 'supplier_id', 'supplier_invoice_id', 'ap_voucher_id'],
  document_flow_links: ['request_id', 'source_document_type', 'source_document_id', 'target_document_type', 'target_document_id'],
};

async function verifyP2PSchemaContract(client = pool) {
  const { rows } = await client.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=ANY($1::text[])`,
    [Object.keys(REQUIRED_COLUMNS)]
  );
  const present = new Set(rows.map(({ table_name: table, column_name: column }) => `${table}.${column}`));
  const missing = Object.entries(REQUIRED_COLUMNS).flatMap(([table, columns]) =>
    columns.filter((column) => !present.has(`${table}.${column}`)).map((column) => `${table}.${column}`));
  const constraints = await client.query(
    `SELECT conname FROM pg_constraint
      WHERE conname IN ('ap_payables_supplier_id_fkey','document_flow_links_unique_edge')`
  );
  const foundConstraints = new Set(constraints.rows.map((row) => row.conname));
  for (const name of ['ap_payables_supplier_id_fkey', 'document_flow_links_unique_edge']) {
    if (!foundConstraints.has(name)) missing.push(`constraint:${name}`);
  }
  const index = await client.query("SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_ap_payables_supplier_id'");
  if (!index.rowCount) missing.push('index:idx_ap_payables_supplier_id');
  if (missing.length) {
    const error = new Error(`P2P schema contract is not deployed (${missing.join(', ')}). Apply reviewed manual migration 031.`);
    error.code = 'P2P_SCHEMA_CONTRACT_MISSING';
    error.missing = missing;
    throw error;
  }
  return { ok: true };
}

if (require.main === module) {
  verifyP2PSchemaContract()
    .then(() => { console.log('P2P schema contract verified'); return pool.end(); })
    .catch(async (error) => { console.error(error.message); await pool.end(); process.exitCode = 1; });
}

module.exports = { verifyP2PSchemaContract, REQUIRED_COLUMNS };