# Phase 1B database contract requirements

This document is descriptive only. It contains no executable SQL.

## DBR-001 — Stock Item mapping history
- **Feature:** governed mapping transitions, supersession, and rollback
- **Table:** `stock_item_master_mappings`
- **Column or database object:** table with stock item, Generic Item, optional Product, status, active flag, version, reviewer/timestamps, reason, and prior identity
- **Expected type:** relational record; identifiers bigint/integer, version integer, status text, active boolean, snapshots JSON
- **Nullable status:** Product and prior snapshot nullable; final reviewer/time non-null for final decisions
- **Expected relationships:** restrict-delete relationships to Stock Item, Generic Item, Product, and users
- **Allowed values:** `proposed`, `review_required`, `approved`, `rejected`, `superseded`, `rolled_back`
- **Read behavior:** immutable history ordered by version/time; at most one active approved row per Stock Item
- **Write behavior:** append proposals and optimistic versioned transitions; never delete
- **Transaction requirements:** approval and live Stock Item update are atomic; supersession/rollback and audit are atomic
- **Backward-compatibility requirements:** legacy unmapped Stock Items remain readable
- **Failure behavior when unavailable:** mapping APIs fail closed with `database_capability_unavailable`

## DBR-002 — Import batches and staging
- **Feature:** idempotent spreadsheet preview and confirmation
- **Table:** `stock_item_import_batches`, `stock_item_migration_staging`
- **Column or database object:** batch metadata/checksum/status; source row, source Stock Item ID, row checksum, validity/errors, omitted flag, parser version
- **Expected type:** identifiers bigint, checksums text, row/error payload JSON, timestamps, status text
- **Nullable status:** invalid source fields nullable; checksum, batch, row number and validation state non-null
- **Expected relationships:** staging belongs to batch; actor references users; source Stock Item is a non-cascading optional reference
- **Allowed values:** batch `uploaded`, `previewed`, `confirmed`, `failed`; row `valid`, `invalid`, `omitted`
- **Read behavior:** retain every submitted and previously staged row, including invalid/omitted rows
- **Write behavior:** checksum-based upsert; never modify live identity or quantity
- **Transaction requirements:** confirmation, staging, candidate generation request, and audit are atomic
- **Backward-compatibility requirements:** repeated workbook/row checksums return existing results
- **Failure behavior when unavailable:** import APIs fail with `database_capability_unavailable`

## DBR-003 — Attribute suggestions/templates
- **Feature:** category parsers and explainable candidates
- **Table:** `stock_item_attribute_suggestions`, `item_attribute_templates`
- **Column or database object:** suggestion evidence, confidence, rule/parser version; governed template definitions
- **Expected type:** JSON-compatible values, decimal confidence, text keys/versions
- **Nullable status:** evidence may be nullable; key, value, confidence and parser version non-null
- **Expected relationships:** suggestion belongs to staging row; template belongs to controlled category
- **Allowed values:** governed template value domains; confidence 0 through 1
- **Read behavior:** expose source evidence and parser version
- **Write behavior:** append suggestions; never auto-approve a mapping
- **Transaction requirements:** generated with staging confirmation
- **Backward-compatibility requirements:** older parser versions remain readable
- **Failure behavior when unavailable:** candidates can be computed for preview but cannot be confirmed

## DBR-004 — Warehouse supply identity
- **Feature:** normalized warehouse supply items and templates
- **Table:** warehouse supply request item and template item tables
- **Column or database object:** `stock_item_id`, `generic_item_id`, `item_name_snapshot`
- **Expected type:** integer identifiers and text snapshot
- **Nullable status:** IDs nullable for legacy rows; snapshot non-null on new writes
- **Expected relationships:** Stock Item and Generic Item foreign-key relationships with restricted deletion
- **Allowed values:** existing active identity IDs
- **Read behavior:** prefer Stock Item ID, then Generic Item ID, then legacy name
- **Write behavior:** never resolve by name when an ID is supplied
- **Transaction requirements:** identity snapshot and request/template item write atomically
- **Backward-compatibility requirements:** preserve legacy name-only reads
- **Failure behavior when unavailable:** capability false and use explicit legacy behavior only

## DBR-005 — Warehouse replenishment policy contract
- **Feature:** Add Item to Inventory warehouse configuration
- **Table:** `warehouse_replenishment_policies`
- **Column or database object:** warehouse/Stock Item unique key; reorder point, safety stock, lead time days, review period days, lot size, active, updater
- **Expected type:** identifiers integer, quantities numeric, day fields integer, active boolean
- **Nullable status:** policy values non-null with zero defaults
- **Expected relationships:** belongs to warehouse and Stock Item
- **Allowed values:** all numeric values nonnegative
- **Read behavior:** one effective policy per warehouse and Stock Item
- **Write behavior:** deterministic upsert from validated payload
- **Transaction requirements:** same transaction as Stock Item and zero warehouse setup
- **Backward-compatibility requirements:** existing policies remain readable
- **Failure behavior when unavailable:** roll back the entire Add Item operation

## DBR-006 — Warehouse inventory scope
- **Feature:** duplicate identity and zero-level setup
- **Table:** `warehouses`, `warehouse_stock_levels`
- **Column or database object:** `warehouses.institute_id`; stock level `generic_item_id`
- **Expected type:** integer identifiers
- **Nullable status:** institute non-null for normalized creation; generic ID non-null for new normalized setup
- **Expected relationships:** warehouse institute scope; stock level belongs to warehouse, Stock Item, Generic Item
- **Allowed values:** active referenced records
- **Read behavior:** institute defines inventory-organization duplicate scope
- **Write behavior:** zero quantity only; no batch creation
- **Transaction requirements:** atomic with Stock Item creation
- **Backward-compatibility requirements:** legacy levels without Generic ID remain readable
- **Failure behavior when unavailable:** reject normalized creation without partial writes

## DBR-007 — Ownership/consignment identity
- **Feature:** complete duplicate semantics
- **Table:** `stock_items`
- **Column or database object:** governed ownership/consignment state
- **Expected type:** constrained text or controlled reference
- **Nullable status:** non-null with owned default for normalized items
- **Expected relationships:** optional ownership organization when applicable
- **Allowed values:** at minimum `owned`, `consigned`
- **Read behavior:** participates in duplicate key
- **Write behavior:** controlled selection only
- **Transaction requirements:** written with Stock Item
- **Backward-compatibility requirements:** legacy null interpreted using documented owned default
- **Failure behavior when unavailable:** do not use caller-supplied text to distinguish duplicates

## DBR-008 — Concurrent normalized identity uniqueness
- **Feature:** duplicate-safe concurrent Add Item to Inventory
- **Table:** normalized Stock Item inventory scope
- **Column or database object:** enforceable identity key covering Generic Item, nullable Approved Product, Inventory UOM, and institute/inventory-organization scope
- **Expected type:** unique relational key or equivalent atomic database object
- **Nullable status:** Product is nullable and nulls compare as the same Generic-only identity; scope is non-null
- **Expected relationships:** scope belongs to an institute represented by selected warehouses
- **Allowed values:** active controlled identity references only
- **Read behavior:** duplicate lookup returns the existing Stock Item identifier
- **Write behavior:** concurrent equivalent creation permits one winner only
- **Transaction requirements:** conflict occurs inside the Stock Item/warehouse/policy/audit transaction
- **Backward-compatibility requirements:** legacy duplicates remain readable and are remediated through mapping stewardship
- **Failure behavior when unavailable:** application locking is best-effort; deployments requiring strict concurrent safety must keep normalized creation disabled

## DBR-009 — Warehouse supply request and template line identity
- **Feature:** stable warehouse supply write identity
- **Table:** `warehouse_supply_items` and warehouse supply template item storage
- **Column or database object:** `stock_item_id`, `generic_item_id`, `item_name_snapshot`
- **Expected type:** integer references and text snapshot
- **Nullable status:** identifiers nullable only for historical legacy rows; snapshot required on normalized writes
- **Expected relationships:** Stock Item and Generic Item references use restricted deletion
- **Allowed values:** referenced normalized identities visible to the request warehouse
- **Read behavior:** prefer stable IDs while retaining historical display snapshots
- **Write behavior:** derive Generic Item/name snapshot from Stock Item; never fall back to name after an ID lookup fails
- **Transaction requirements:** identity validation and line write are atomic
- **Backward-compatibility requirements:** name-only historical records remain readable
- **Failure behavior when unavailable:** normalized write fails with `warehouse_identity_unavailable`; no silent legacy line is created