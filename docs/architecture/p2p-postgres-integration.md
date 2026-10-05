# Disposable PostgreSQL P2P integration checks

Run from `purchase-backend` after `npm ci`:

```sh
npm run test:p2p-postgres
```

Requires Node 20+, a running Docker daemon and permission to pull the official
PostgreSQL 16 image. The runner pins its image digest, creates a new database in
an ephemeral container, binds it to a random loopback port and removes its own
container on completion. No database service needs to be started separately.
Normal `npm test` continues to run the Jest suite without requiring Docker.

Validation for this change: 16/16 PostgreSQL integration checks and the complete
backend regression suite (170 suites, 1,214 tests) passed. Syntax checks and
`git diff --check` also passed. No frontend or API contract changed.

The runner generates its own credentials and overrides `DATABASE_URL` for the
test child process. It never uses the supplied development/production database
URL. The suite rejects non-loopback destinations, ordinary database names and
connection query overrides before importing application modules. It also refuses
to initialize an existing public schema. No shared database is reset or migrated.

## Verified scenarios

The 16 tests exercise actual service/repository SQL, PostgreSQL transactions,
row/advisory locks, uniqueness constraints, audit and notification outbox writes:

- Approved request → award → PO approval/issue → budget commitment → partial
  receipt including damaged quantity → two matched invoices → finance verification
  → AP vouchers/postings → budget actualization → partial/full payments → completion.
- Missing PO approval and insufficient budget reject without partial writes.
- Inventory receiving retries and competing receipts cannot duplicate movements,
  allocations or stock, or exceed the ordered quantity. Scope and permission
  violations fail with no persisted effects.
- An audit failure after inventory mutations rolls back receipt, stock, movement,
  allocation and document/outbox effects.
- Competing invoice matches serialize available quantity and retain an exception
  for over-invoicing.
- An outbox failure after AP mutation rolls back posting, payable, commitment
  actualization and the consumed-budget projection.
- Concurrent AP retries create one liability and one actualization. Competing
  payments cannot overpay; retries cannot duplicate allocations.
- Closing an order with a matched or finance-verified invoice, draft voucher or
  verified voucher cannot mark finance complete before AP posting.
- Terminal replacement invoices do not block an otherwise settled request.
- A reasoned partial close releases unused commitment while receipt completion
  remains false.

The tests exposed PostgreSQL `42P08` failures where a reused parameter was inferred
as both a numeric ID and text. Explicit numeric-to-text casts now permit commitment
creation, actualization and voucher-number creation. Finance completion now requires
posted, correctly linked voucher/payable evidence for every active invoice; the
previous three-status filter missed intermediate invoice/voucher states. Pending
or exception statuses continue to block completion even if posting evidence exists.

## Limits and deployment

`integration/fixtures/p2p.sql` is a focused test schema, not a production migration
or a full copy of the deployed schema. It omits unrelated domains, migration
preflight, Supabase RLS/auth and legacy data. These are service-level tests; they
do not establish full HTTP approval authorization or segregation of duties.

The main lifecycle uses NON_INVENTORY lines. Inventory scenarios explicitly seed
an already classified INVENTORY PO line because the award-to-PO API currently
does not select that classification. They verify receiving onward, not automatic
classification from request to stock. Replacement cancellation is seeded as a
terminal state; cancellation/reversal workflows are not implemented by these tests.

No database migration is required for the runtime fixes. Deploy the backend after
review and merge. No historical data is changed. The approved development Supabase
project was inspected through its HTTPS schema API; native PostgreSQL pooler
connections from this environment are refused. The disposable checks therefore
do not prove deployed-schema compatibility or replace development-environment
acceptance and reconciliation. General-ledger policy/integration remains pending.

Next: complete development schema/constraint verification and a controlled
acceptance run, then agree the inventory classification and contract-liability
integration boundaries recorded in the ERP roadmap.
