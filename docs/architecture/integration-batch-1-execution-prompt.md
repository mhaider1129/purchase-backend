# Integration Batch 1: repository audit and execution prompt

## Purpose

This document turns the proposed **PR → Award → PO → GR → Invoice → AP →
Payment** hardening batch into an implementation prompt based on the code that
is currently live. It deliberately does not prescribe a `modules/*` directory
move. The next change should close authority and provenance gaps in place.

## What the repository already does

The connected P2P path is considerably further along than an architecture-only
assessment suggests. The next implementation must preserve these existing
authorities rather than create parallel replacements.

| Fact | Current authority | Evidence in the implementation |
| --- | --- | --- |
| Award | `procurementAwardService` through `connectedP2PRepository` | Locks the request item, enforces Supplier Master identity, validates governed product/catalog/UOM identity, caps awarded quantity, and records an idempotent award. |
| PO | `purchaseOrderService` through `connectedP2PRepository` | Creates a PO only from active awards; supplier, request, currency, item identity, UOM snapshot, quantity, price, and price source are inherited from awards. Issue performs the budget commitment. |
| Goods receipt | `goodsReceiptService` through `connectedP2PRepository` | Locks the PO and lines, checks request ownership and remaining quantity, records the GR, updates PO receipt projections, and delegates inventory movements to the inventory posting authority. |
| Invoice and match | `supplierInvoiceService` plus `invoiceMatchingService` | Invoice supplier and lines must belong to the PO. Matching uses accepted receipt quantities for physical lines, two-way matching for service lines, and append-only override evidence. |
| AP liability | `accountsPayableService` then `apPostingService` | A finance-verified invoice becomes a balanced voucher; only a verified voucher can be posted, actualize the PO commitment, and create a payable. |
| Payment | `paymentService` through `connectedP2PRepository` | A payment must allocate to an open, posted payable; locking, idempotency, currency validation, and remaining-balance checks prevent duplicate or excess settlement. |
| Document flow | `document_flow_links` through repository helpers | Links currently cover PR → Award → PO → GR/Inventory and PO → Invoice → Match → Voucher → Posting → Payable → Payment. |

The production command routes are concentrated in
`routes/procureToPay.js`. The unscoped PO creation route is marked deprecated,
status-only payment routes return HTTP 410, and direct invoice-to-payable
posting returns HTTP 410. These are compatibility surfaces, not alternative
authorities.

## Remaining Batch 1 gaps found in live code

### 1. Request-scoped URLs do not all enforce their scope

Goods receipt creation passes `requestId` into its service and rejects a PO from
another request. Invoice submission, invoice matching, match override, voucher
creation, and several finance commands use request-scoped URLs but do not all
pass/assert the route request against the locked aggregate. A URL such as
`/requests/A/invoices/B/match` must never operate on an invoice belonging to
request `C`, even when the user is otherwise authorized.

Scope validation belongs inside the same transaction that locks the canonical
aggregate. A controller-only pre-read would introduce a time-of-check/time-of-use
gap and duplicate repository logic.

### 2. AP does not retain canonical supplier identity

`supplier_invoices` and POs carry `supplier_id`, but `ap_payables` is populated
with only `supplier_name`. That name is useful as a historical display snapshot,
but it is insufficient as AP's operational supplier identity. The payable should
carry an immutable `supplier_id` FK inherited from the locked invoice/PO chain;
reads should join Supplier Master by ID and use the snapshot only as fallback.

### 3. RFx provenance is partly implicit

RFx award orchestration creates awards with `source_type='QUOTATION'` and a
polymorphic `source_id`, while PO lines retain award and price-source fields.
This is strong transactional provenance, but the document-flow graph starts at
PR → Award and does not explicitly link RFx event/response → Award. Add those
links so the standard document-flow API can answer why a supplier and price were
selected without special RFx-table knowledge. Do not replace the existing
award/PO foreign keys with document links; links are navigational evidence.

### 4. Compatibility command surfaces remain reachable

The deprecated global `POST /purchase-orders` still performs the same command as
the request-scoped route. The legacy invoice-payment adapter in
`paymentService` can still write when called with a non-transactional legacy
repository. Batch 1 should remove or fail closed these command paths after
confirming there are no production callers. A deprecation header is not a
writer boundary.

### 5. Runtime DDL remains in P2P request handling

P2P list/detail controllers still call `ensureProcureToPayTables` and, in some
cases, finance/warehouse ensure helpers. Schema creation and alteration must be
migration-owned. Replace request-time bootstrap calls for the Batch 1 path with
startup schema-contract verification that fails with an actionable error and
does not mutate the database. Preserve explicit migration tooling; do not run
manual SQL from application startup.

### 6. Read models still treat names as searchable identity

Several PO, invoice, payable, payment, and document-flow queries filter or render
the persisted supplier-name snapshot directly. Search by name is acceptable,
but the query must join `suppliers` through canonical `supplier_id`; snapshots
are fallback display data only. Read-model cleanup must not rewrite historical
transaction snapshots.

## Exact implementation prompt

Copy the prompt below into the implementation task.

---

### Supply Chain Integration Hardening — Batch 1 closure

Implement the next in-place hardening increment for the existing modular
monolith. Do **not** create or move code into `modules/*`, do not redesign the
working services, and do not add screens. Preserve the existing canonical chain:

`Approved PR → Award → PO → PO commitment → GR → Invoice → Match → Finance
Verification → AP Voucher → AP Posting/Payable → Payment`.

#### A. Enforce request ownership transactionally

1. For every request-scoped P2P command, parse a positive `requestId` and pass it
   to the owning service.
2. In the service transaction, after locking the canonical root record, reject a
   route/request mismatch with a stable error code such as
   `REQUEST_SCOPE_MISMATCH` and HTTP 409 (use one convention everywhere).
3. Cover at least invoice submission, invoice match, match override, AP voucher
   creation, finance verification/posting where applicable, and any remaining
   request-scoped payment command. Keep receipt's existing ownership check but
   normalize its error code/status to the same convention.
4. Never trust a request ID, supplier ID, amount, or status from the URL/body
   when it can be derived from the locked PO, invoice, voucher, or payable.

#### B. Make Supplier Master identity continuous through AP

1. Add a reviewed migration that introduces `ap_payables.supplier_id` as a FK to
   `suppliers(id)`, with an index and a safe backfill through
   `ap_payables → supplier_invoices → purchase_orders`.
2. The migration must preflight ambiguous/unresolvable rows and must not infer
   identity by supplier name. Decide and document whether unresolved historical
   rows block the constraint or remain nullable for a staged cutover.
3. Update `apPostingService` and the connected repository so newly posted
   payables copy `supplier_id` from the locked invoice. Keep `supplier_name` as
   an immutable display snapshot only.
4. Update AP/payment/document-flow reads to join Supplier Master by ID and use
   `COALESCE(master.name, snapshot)` only for display. Filtering by a supplier ID
   must use the FK; text search may use the joined display expression.

#### C. Complete award provenance in document flow

1. When the RFx award transaction creates each award, write explicit document
   links from the RFx event and winning RFx response/quotation to the award.
2. Keep PR → Award and Award → PO links. Do not use document links as integrity
   substitutes for `award_id`, `request_item_id`, `supplier_id`, or source IDs.
3. Ensure retries do not create duplicate links. Add the appropriate unique
   constraint/idempotent repository operation if the current schema lacks one.
4. Extend the lifecycle/document-flow response tests to prove navigation from PR
   through RFx response, award, PO, GR, invoice, match, AP, and payment.

#### D. Close remaining duplicate command paths

1. Search backend and frontend callers before changing routes.
2. Remove the global PO creation route or make it return HTTP 410; the sole live
   creation route must be the request-scoped award-based command.
3. Delete or fail closed `postLegacyInvoicePayment`; every production and test
   payment must use a posted `ap_payable` ID.
4. Retain historical read compatibility where needed, but no compatibility path
   may insert/update awards, POs, GRs, invoices, matches, vouchers, payables, or
   payments outside `connectedP2PRepository` and the named domain service.
5. Extend the canonical-writer boundary test so it detects both direct SQL and
   callable legacy service adapters.

#### E. Remove runtime DDL from the Batch 1 HTTP path

1. Inventory every `ensure*Tables` call reachable from P2P routes.
2. Move the required schema to ordered migrations. Do not silently recreate
   tables/columns/indexes during a request.
3. Add a read-only schema contract verifier at startup or deployment validation.
   It must report missing migration/version/capability information and fail
   closed without executing DDL.
4. Remove P2P controller calls to runtime ensure helpers only after tests prove
   the migration contract contains every required table, column, FK, index, and
   constraint.

#### F. Integration and regression proof

Add one database-backed golden-transaction test (or the repository's established
transactional integration-test equivalent) that proves:

1. an approved request item is awarded to a Supplier Master ID from a quotation;
2. the PO inherits award, request-item, supplier, product/catalog, price-source,
   currency, and UOM provenance;
3. PO issue creates exactly one commitment;
4. a partial GR records gross/damaged/short/accepted quantities and posts stock
   only through the inventory posting service;
5. cumulative invoice quantities cannot exceed accepted receipts for a physical
   item, while a service line follows two-way matching;
6. only a verified match (or evidenced approved override) can pass finance and
   create/post one balanced AP voucher and one payable;
7. the payable retains the same `supplier_id` as award, PO, and invoice;
8. partial and final payments update only payable/payment authority, reject
   overpayment and duplicate idempotency payloads, and do not create expenditure;
9. wrong-request route IDs fail without side effects;
10. the document graph contains the complete RFx/quotation → Award → PO → GR →
    Invoice → Match → Voucher → Posting → Payable → Payment lineage; and
11. a forced audit/outbox failure rolls back each tested command atomically.

Also retain focused unit tests for decimal quantities, duplicate supplier invoice
numbers per supplier, mixed-supplier awards, over-award/over-order/over-receipt,
invalid aggregate state transitions, and concurrent idempotency retries.

#### Acceptance criteria

- Exactly one reachable writer exists for each governed business fact.
- No live P2P command derives supplier identity from a name.
- Every new payable has a canonical `supplier_id`.
- Every request-scoped mutation validates scope inside its transaction.
- PO commercial data is inherited from awards, never retyped by the caller.
- GR, invoice, AP, and payment quantities/amounts remain separate facts.
- Runtime P2P HTTP requests execute no DDL.
- Existing migrations remain manual/deployment controlled; tests do not execute
  SQL against a shared or production database.
- All existing P2P, inventory, budget, and fixed-asset tests continue to pass.
- Update the architecture authority table and route deprecation notes to match
  the final implementation, including any deliberately staged historical-data
  exception.

#### Required implementation report

In the resulting PR, include:

1. a before/after writer inventory;
2. migration and rollback notes;
3. supplier-ID backfill diagnostics;
4. route removals/deprecations and confirmed callers;
5. exact tests run and any environment-limited database checks; and
6. explicit confirmation that no shared/production database was modified.

---

## Suggested review order

Review migration safety and supplier backfill first, then transaction-scoped
ownership checks, then command reachability, and finally read-model/runtime-DDL
cleanup. This keeps identity and writer authority ahead of cosmetic API changes
and avoids conflating Batch 1 with the later receiving-disposition work.