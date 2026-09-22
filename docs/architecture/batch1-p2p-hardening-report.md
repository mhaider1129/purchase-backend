
# Supply-chain integration hardening — Batch 1

## Authority and writer inventory

| Fact | Before | After |
| --- | --- | --- |
| Award | `procurementAwardService` / connected repository | Unchanged; RFx event and winning response now add idempotent navigation links to every award. |
| Purchase order | Request-scoped and deprecated global routes both invoked `purchaseOrderService` | Only `POST /requests/:requestId/purchase-orders` writes; the global command returns 410. Award locks remain the commercial-data authority and now validate route scope. |
| Receipt | `goodsReceiptService` / connected repository | Unchanged writer; its locked PO scope mismatch now consistently returns `REQUEST_SCOPE_MISMATCH`/409, including retries. |
| Invoice and match | `supplierInvoiceService` / connected repository | Unchanged writer; submission, match, and override validate request scope after locking their canonical PO/invoice/match. |
| AP voucher/posting/payable | AP services / connected repository | Unchanged writer; scoped creation/posting validate the locked aggregate and new payables inherit immutable `supplier_id`. |
| Payment | Payable command plus a callable legacy invoice adapter | Only posted-payable payment remains; the legacy adapter fails closed with 410. |

The canonical-writer test covers both governed SQL mutations and the removed
legacy service adapter. Historical read compatibility remains, but Supplier
Master names are preferred through canonical IDs and transaction snapshots are
only display fallbacks.

## Migration, backfill, and rollback

Manual migration `031_p2p_batch1_authority_hardening.sql` adds the non-null
`ap_payables.supplier_id` FK and index. Backfill follows payable → invoice → PO
IDs and requires invoice and PO supplier IDs to agree. It never resolves by
name. This deliberately chooses a blocking cutover: missing links, null IDs,
conflicting IDs, pre-populated conflicts, or duplicate document-flow edges
abort the transaction before data changes. Run the paired read-only diagnostic
first; both result sets must be empty. Rollback statements are included at the
end of the migration and must be reviewed for downstream dependencies.

The same migration adds the unique document-flow edge constraint used by the
repository's idempotent upsert. RFx award orchestration records `RFX_EVENT →
AWARD` and `RFX_RESPONSE → AWARD`; the existing PR/award/PO and downstream links
remain integrity-backed by their original foreign keys.

## Route and runtime schema closure

Repository and frontend searches found no legitimate caller that requires the
global PO writer; it now returns 410. Status-only payment and direct
invoice-to-payable routes remain 410 compatibility responses. P2P controllers
no longer invoke any `ensure*Tables` helper, so HTTP reads and commands perform
no DDL. `npm run verify:p2p-schema` is a read-only deployment/startup contract
check with actionable missing-column/constraint/index output; it never repairs
schema and does not replace manual migration review.

## Operational confirmation

No shared or production database was modified while implementing or testing
this batch. Database migration execution and the read-only contract check must
be run by deployment operators against the intended environment. Unit and
static integration tests use mocks/files only; the repository's complete test
suite remains the regression gate.