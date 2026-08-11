# Phase 3B inventory operations report

## Delivered

* Transfers separate dispatch from receipt, link transfer lines to dispatch and receipt movements, support partial receipts, preserve allocation identity, and compensate unreceived dispatch cancellation without deleting ledger records.
* Status transfers atomically debit one status and credit another with a correlation group. Supported paths cover quarantine/release, recall/release, block/release, damage, and expiry. Damage/expiry release remains deferred pending an approved correction rule.
* Adjustments require permission, actor, reason, source reference, tracking identity, and idempotency.
* Reservations change `reserved_quantity`, never on-hand, are document-scoped, idempotent and releasable; issue posts a physical ISSUE.
* Cycle-count posting records variance and delegates only an approved reviewed variance to adjustment service.
* FEFO is centralized with NULL expiry last and ID tie-break. Batch/lot/serial/expiry snapshots survive movements and transfers.

## Compatibility and deferred decisions

The legacy transfer `approve` endpoint dispatches for backward compatibility; clients should use receipt to create destination stock. Partial receipts are supported. Item master lacks dependable tracking-policy flags, so strict serial rules activate only after explicit master-data fields are introduced. Supplier, ward/patient and department-return acceptance coordinators were not identifiable as live direct writers; detailed condition/financial semantics remain a future workflow. Legacy movement reads remain reporting-only.

## SQL 005 and operations

SQL 005 adds only transfer links/lifecycle columns, reservations, cycle counts, indexes, constraints, and missing permission catalog entries. It is manual-only. Lock order is business document, warehouse, item, balances ordered by canonical identity/ID.

## Smoke checklist

1. Dispatch a two-batch transfer and verify only source on-hand falls.
2. Partially receive it and verify destination tracking snapshots and remaining quantity.
3. Retry both calls with identical keys and verify no duplicate movement.
4. Attempt over-receipt and confirm HTTP 409.
5. Quarantine/release one exact lot and confirm total physical on-hand is unchanged.
6. Post positive/negative adjustments; confirm reason/audit/allocation and insufficient-stock rejection.
7. Race two reservations and confirm their total never exceeds available.
8. Release one reservation, then issue another and confirm reserved/on-hand changes.
9. Approve/post a count variance twice and confirm the retry is rejected.
10. Run the direct-write search and inspect the classifications in the closure document.

## Recommended next phase

Add explicit serial/batch/expiry control fields to item master, build condition-aware department and supplier return coordinators, retire compatibility movement reads, and add database-backed concurrency integration tests after SQL 005 is reviewed and manually applied.