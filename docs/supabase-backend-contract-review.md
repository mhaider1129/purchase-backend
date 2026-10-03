# Supabase database contract review

## Scope and comparison method

This review treats the three supplied files as the deployed Supabase baseline:

- `sql/View_Supabase_SQL.sql`: schema snapshot (100 tables).
- `sql/permissions_Table.sql`: permission rows (140 unique codes).
- `sql/UI_resource_permissions.sql`: UI access rows (36 resource keys).

The baseline was compared with the backend's SQL lineage (`sql/manual/004` through
`034`, the dated migrations that add procurement events, supplier principals, Item
Master, and document branding), current repository/service SQL, authorization checks,
and concrete frontend `feature.*` resource keys. This is deliberately **not** a
comparison with only migration 034.

The executable result is `sql/Supabase_Backend_Contract_Patch.sql`. It preserves the
preflight and compatibility gates from the source migrations. These gates are
important: several migrations must stop when production rows cannot be safely
backfilled without a business decision.

## Schema gaps

The supplied schema snapshot is missing 79 tables created by the governed SQL lineage,
plus `contract_items`, which the legacy contracts controller creates lazily but later
governed migrations require. The patch installs or validates them in dependency order.

### Inventory and connected procure-to-pay

Missing objects include `inventory_transaction_allocations`, transfer/allocation/receipt
link tables, reservations and reservation operations, cycle counts and lines,
`rfx_response_items`, `procurement_awards`, and `invoice_match_override_decisions`.
The existing inventory, purchase-order, receipt, invoice, payable, payment, and finance
tables also need the columns, constraints, indexes, immutability triggers, idempotency
keys, and authority rules in SQL 004-006, 009, 025, and 031.

### Item Master and supplier identity

The snapshot contains foreign keys that name Item Master relations but omits the
relations themselves. Missing tables include `generic_items`, `approved_products`,
`supplier_catalog_items`, `pending_item_requests`, `item_duplicate_reviews`,
`item_master_aliases`, `legacy_item_mappings`, `generic_item_merges`,
`item_master_audit_events`, `item_uom_conversions`, and `supplier_principals`.
`procurement_item_events` is also absent. The patch includes the full foundation and
reference/UOM hardening rather than merely creating empty placeholder tables.

### Performance and procurement priority

Missing tables include `procurement_cases`, `procurement_case_activities`,
`procurement_case_complexity_factors`, `procurement_value_events`,
`procurement_priority_profiles`, `department_priority_rankings`,
`procurement_priority_history`, `procurement_priority_groups`, and
`procurement_priority_group_members`.

### Organization and approval engine

Missing tables include `organization_units`, `organization_positions`,
`organization_head_reconciliation_decisions`, all eight approval-policy foundation
tables, `approval_authority_delegations`, `approval_route_snapshots`, and
`approval_route_snapshot_steps`. The patch also applies required exclusion constraints,
indexes, policy shadow compatibility, route generation, and snapshot hardening.

### Spare parts, assets, RFID, and maintenance

Missing objects include the approved-spare-parts/equipment foundation; Asset Register
categories, locations, number allocation, assets, movements, and tags; RFID readers,
antennas, portals, integration clients, reads, business events, and exceptions;
maintenance work orders and their inventory execution links; and all physical-inventory
session, observation, discovery, finding, and resolution tables. The later hardening
migrations are included because creating only the foundation tables would still leave
the backend contract incomplete.

### Platform additions

`document_branding_settings`, `ai_interactions`, and `ai_tool_executions` are absent.
The AI provider audit column hardening is included after the AI foundation.

## Permission catalog review

No permission code is missing from `permissions_Table.sql` for current backend
authorization. Its 140 unique codes include all codes installed by the governed SQL
lineage through AI Intelligence. Do not replace this table or delete extra permission
rows: `role_permissions` and `user_permissions` are business assignments and must be
preserved. The patch uses the migrations' code-based upserts and finally repairs the
`permissions.id` sequence after the baseline's explicit numeric IDs.

Descriptions and display names are not perfectly identical between every historical
migration, runtime seed, and the dump. Authorization is keyed by `permissions.code`, so
those wording differences are not missing security capabilities.

## UI resource permission review

No concrete UI resource key used by the current frontend is missing from
`UI_resource_permissions.sql`: all 36 keys are present. The apparent strings
`feature.nav`, `feature.path`, `feature.resourceKey`, `feature.requiredPermissions`, and
`feature.requireAllPermissions` are JavaScript property access found by lexical search,
not resource keys, and must not be inserted.

The patch therefore does not overwrite UI policy choices. In particular, empty arrays
for public/authenticated features such as approval history, demand planning, and the
read-only Item Master entry are intentional under the current UI access design, not
missing data.

## Running the patch in Supabase

1. Take a Supabase backup and run the patch in staging first.
2. Open Supabase **SQL Editor**, paste the complete contents of
   `sql/Supabase_Backend_Contract_Patch.sql`, and run it as the database owner.
3. If a preflight raises a named `SQL_...` exception, do not bypass it. Resolve the
   reported partial schema or ambiguous historical rows, then rerun the same patch.
   Each source migration has its own transaction, so already completed compatible
   steps validate/no-op on rerun.
4. Re-export the schema and the two data tables after a successful run. The existing
   `View_Supabase_SQL.sql` warning correctly says it is contextual and is not itself an
   executable migration.

## Important operational boundary

The backend still contains older endpoint-level `CREATE TABLE IF NOT EXISTS` helpers.
This patch bootstraps `contract_items` because governed SQL 022 directly depends on it;
other legacy helpers remain application-managed and are outside the forward-only manual
migration lineage. They should eventually be moved into reviewed migrations, but they
must not be guessed into this patch because some have production-data-dependent shapes.