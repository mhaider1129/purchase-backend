# P2P transaction boundaries

All commands use `withTransaction`; repositories accept its client and never fall back to the pool.

| Command | Locks and atomic work |
|---|---|
| Create award | lock request item; re-read active award sum; eligibility; idempotency insert; audit/outbox |
| Release PO | lock PO and budget envelope; eligibility/provenance/totals; budget check + commitment; transition; audit/outbox |
| Post receipt | lock PO lines; idempotency insert; reject quantity above remaining; for inventory invoke canonical adapter in same transaction; update projection |
| Submit invoice | advisory/row lock supplier+normalized invoice number; insert header/lines; audit/outbox |
| Match invoice | lock invoice and relevant PO/receipt rows; persist immutable structured result; transition matched/exception |
| Post payment | lock invoice(s); re-sum posted allocations; reject overpayment; idempotency insert/allocation/status/audit |
| Cancel/reverse | lock aggregate and dependencies; append cancellation/reversal, release unused commitment where allowed; never delete history |

Unique idempotency/identity constraints are the final concurrency guard. Notification delivery and email occur only after commit. Failures roll back every business, audit, and outbox write together.