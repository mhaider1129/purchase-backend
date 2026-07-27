# Item Master and Procurement Foundation

## Repository assessment

The current system contains two overlapping masters. `item_master` is a partially
normalized record with manufacturer and brand columns, while `item_master_items`
combines generic identity, brand, cost, preferred suppliers and replenishment
settings. The latter powers the current UI and must remain available during the
transition. Stock, request and warehouse modules also retain legacy name/code
fields; those are compatibility fields, not identifiers for new integrations.

Schema creation is frequently performed by `ensure*` helpers at request time.
New item-master objects are migration-owned instead. Existing helpers are left in
place only for unchanged legacy modules and should be retired through a separate
deployment-readiness programme.

Authentication attaches database-backed permissions to the user context. Global
write middleware records redacted write requests in `governance_audit_trail`.
The new APIs reuse both facilities. Supplier, contract, request, stock and
warehouse tables are reused rather than duplicated.

## Incremental target

The authoritative hierarchy is:

1. `generic_items`: manufacturer- and supplier-neutral functional identity.
2. `approved_products`: an exact manufactured product approved against one
   generic item.
3. `supplier_catalog_items`: a supplier's commercial offer for one approved
   product.

`generic_items` is authoritative for every new Generic Item and procurement
integration. `item_master` and `item_master_items` are read-only compatibility
sources except for users holding `item-master.legacy-maintain`; steward mappings
are explicit and never activate copied legacy data.

`pending_item_requests` provides a governed exception route without creating any
master record. `item_duplicate_reviews` records steward decisions. Additive
foreign keys on request, stock and transaction tables allow gradual migration to
internal IDs while legacy text remains readable.

Generic lifecycle transitions are deliberately explicit: draft → review →
validation → approval → active → retired. Activation is blocked while unresolved
structured duplicate candidates exist. Product approval and supplier-catalog
management have separate permissions and business rules.

## API and UI plan

The `/api/item-master/foundation` namespace provides paginated hierarchy search,
generic creation and transitions, duplicate review, product creation/approval,
supplier catalog CRUD, and pending-item submission/queue/resolution. The legacy
`/api/item-master` contract remains unchanged.

The Item Master page introduces a hierarchy workspace with debounced search and
distinguishable product/catalog details. The legacy editor remains available as
a compatibility workspace until callers and historical data are migrated.

## Known debt and next increments

- Backfill and steward-review legacy `item_master_items` before making new foreign
  keys mandatory in requests or inventory.
- Replace remaining name-based warehouse matching after coverage reports show no
  unmapped records.
- Move all remaining controller/runtime DDL into ordered migrations.
- Add lot/serial subledgers and receipt-level product capture once receiving is
  migrated to approved products and supplier catalog IDs.
- Add terminology services (for example GS1/GTIN and clinical classifications),
  contract price breaks and supplier-performance ranking in later increments.