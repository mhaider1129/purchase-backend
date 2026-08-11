# Phase 3B direct-write closure

Repository-wide direct-write search leaves only `repositories/inventoryRepository.js`, the canonical projection writer. SQL schema snapshots/manual migrations and test fixtures are non-live classifications. Active controllers contain no direct INSERT, UPDATE, DELETE, or `ON CONFLICT` against `warehouse_stock_levels`. Legacy `warehouse_stock_movements` is read-only compatibility data and is no longer emitted alongside canonical movements.

Concurrency uses transaction-scoped idempotency/advisory locks plus ordered row locks. Order is business document, warehouse, item, then canonical balances by expiry/ID. This prevents duplicate transfer dispatch/receipt, over-receipt, over-reservation, duplicate cycle posting, and repeated status movement.