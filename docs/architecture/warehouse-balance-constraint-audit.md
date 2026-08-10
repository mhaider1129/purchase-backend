# Warehouse balance constraint audit (Phase 3A)

## Checked-in definition

The schema snapshot defines `warehouse_stock_levels_pkey` on `id`. It records foreign keys
`warehouse_stock_levels_warehouse_id_fkey`, `warehouse_stock_levels_stock_item_id_fkey`,
`warehouse_stock_levels_updated_by_fkey`, `warehouse_stock_levels_batch_id_fkey`, and
`warehouse_stock_levels_generic_item_id_fkey`. No unique constraint or index is printed for this
table in the snapshot.

The runtime bootstrap definition has an unnamed unique constraint on
`(warehouse_id, stock_item_id, batch_id, lot_number, expiry_date, serial_number)`. PostgreSQL's
normal generated name is expected to be
`warehouse_stock_levels_warehouse_id_stock_item_id_batch_id_lot_number_expiry_date_serial_number_key`,
but that name is not explicitly checked in and must be confirmed from the Phase 0 catalog query.
The bootstrap also creates the ordinary non-unique `idx_wsl_warehouse_item` lookup index.

SQL 004 creates non-unique `ix_inventory_balance_lock`, unique
`ux_inventory_balance_identity` (the seven canonical columns with `NULLS NOT DISTINCT`), and the
partial unique `ux_available_serial_location`.

## Obsolete pair uniqueness

No checked-in schema statement creates a unique object on exactly
`(warehouse_id, stock_item_id)`, and therefore no exact deployed name can honestly be asserted from
the repository. Five legacy runtime upserts nevertheless name that pair as an `ON CONFLICT`
arbiter. Those statements can only run where an exact matching unique constraint/index exists;
the conventional possible constraint name is
`warehouse_stock_levels_warehouse_id_stock_item_id_key`, but it is **not** blindly trusted.

SQL 004 first prints every unique object. Under the same balance-table lock it creates the canonical
replacement and ordinary pair lookup index, then uses `pg_index`, `pg_constraint`, and ordered
`pg_attribute` identities to remove only a non-partial, non-expression, exactly two-column unique
object ordered as `warehouse_id, stock_item_id`. Constraint-backed indexes are dropped by constraint
name; standalone indexes are dropped by index name. No other unique or lookup index qualifies.

## `batch_id` compatibility

`batch_id` is not disposable: it is a foreign key to the existing `warehouse_item_batches` entity
and is used by historical warehouse, supply, department, and transaction flows. It is retained for
historical reads. The Phase 3 canonical identity instead snapshots the stable business dimensions
`batch_number`, `lot_number`, `serial_number`, and `expiry_date`; new posting commands map business
batch references to `batch_number` and do not invent or silently copy an integer ID into that text.
SQL preflight reports rows distinguishable only by `batch_id`; these must be reconciled by mapping
the referenced batch entity's business number into `batch_number` before the canonical index is
created. Allocation rows preserve that mapped `batch_number` and the remaining dimensions plus the
source balance ID. SQL 004 does not delete or rewrite `batch_id`.