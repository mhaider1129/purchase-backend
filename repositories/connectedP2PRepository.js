'use strict';

// PostgreSQL adapter for the Phase 4 services. Every lock callback uses the same
// transaction client; this is deliberately not a generic in-memory DI example.
const createConnectedP2PRepository = (client) => ({
  lockRequestItem: async (id, work) => {
    const result = await client.query('SELECT * FROM public.requested_items WHERE id=$1 FOR UPDATE', [id]);
    if (!result.rows[0]) throw Object.assign(new Error('Requested item not found'), { code: 'REQUEST_ITEM_NOT_FOUND' });
    return work(result.rows[0]);
  },
  findByIdempotencyKey: async (key) => (await client.query('SELECT * FROM public.procurement_awards WHERE idempotency_key=$1', [key])).rows[0],
  sumActiveAwards: async (id) => (await client.query("SELECT COALESCE(SUM(awarded_quantity),0)::text AS amount FROM public.procurement_awards WHERE request_item_id=$1 AND status='ACTIVE'", [id])).rows[0].amount,
  insert: async (row) => {
    const columns = Object.keys(row); const values = Object.values(row);
    return (await client.query(`INSERT INTO public.procurement_awards (${columns.join(',')}) VALUES (${values.map((_, index) => `$${index + 1}`).join(',')}) RETURNING *`, values)).rows[0];
  },
  getEligibilityFacts: async (supplierId) => {
    const supplier = (await client.query('SELECT * FROM public.suppliers WHERE id=$1', [supplierId])).rows[0];
    const blocked = (await client.query("SELECT EXISTS (SELECT 1 FROM public.supplier_compliance_artifacts WHERE supplier_id=$1 AND (blocked OR status <> 'active' OR (expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE))) AS blocked", [supplierId])).rows[0]?.blocked;
    if (supplier && blocked) supplier.compliance_status = 'blocked';
    return { supplier, deferred: ['CATEGORY_ELIGIBILITY', 'QUALIFICATION_STATUS', 'BLACKLIST_REGISTRY'] };
  },
});

module.exports = { createConnectedP2PRepository };