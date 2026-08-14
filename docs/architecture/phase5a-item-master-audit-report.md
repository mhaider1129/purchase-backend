# Phase 5A Batch 1 — canonical item identity audit

## 1. Executive summary

The repository already has the correct three-level authority: **Generic Item → Approved Product → Supplier Catalog Item**. It must be consolidated, not replaced. Phase 3/4 added canonical columns but its live transaction writers primarily carry request IDs, stock IDs and text snapshots; exact awarded/received Product and Supplier Catalog identity therefore disappears. `item_master_items` still creates parallel operational identity, while `item_master` is a runtime-created legacy structure without a discovered active create endpoint.

The recommended inventory model is hybrid: Generic is demand/interchangeability authority; Approved Product is physical identity where healthcare traceability applies; Stock Item is the warehouse identity. This audit changes no business behavior and performs no data mutation.

## 2. Entities and authority map

The complete field/writer/reader/UI matrix is in [the identity inventory](phase5a-item-identity-inventory.md). Principal classifications:

* **AUTHORITATIVE:** `generic_items`, `approved_products`, `supplier_catalog_items`; warehouse-level `stock_items`; governance decisions/audit.
* **REFERENCE_MASTER:** `item_categories`, `item_manufacturers`, `item_uom`, with runtime ownership gaps.
* **LEGACY / TO_MIGRATE:** `item_master`, `item_master_items`, variants/brands/conversions, unmapped/exception stock rows.
* **COMPATIBILITY:** aliases, legacy mappings, stock mappings and display snapshots.
* **TRANSACTION_SNAPSHOT / TO_MIGRATE:** request, RFx/award, PO, GR, inventory and contract item records.
* **DISCONNECTED:** merge completion, legacy conversion/variant structures, free-text contract identity and Product/Catalog propagation.

No fourth Item Master is proposed or introduced.

## 3. Authoritative and legacy hierarchies

The [authority model](item-master-authority-model.md) verifies mandatory Product→Generic and Catalog→Product FKs and defines identifier semantics. The legacy migration is: legacy row → steward mapping/alias → Generic → Product only with manufacturer/product evidence. `item_master_items` has active CRUD/approval and continues to create identity. `item_master` overlaps Generic/Product but no active create/update endpoint was found. Neither should be deleted in Batch 1.

## 4. Requested-item identity

Recognized modes and intended rules are:

1. `generic_item`: active Generic, no required Product.
2. `generic_item_with_preference`: active Generic and substitutable `preferred_product_id`.
3. `specific_approved_product`: active Generic, mandatory approved Product, justification.
4. `service`: descriptive service, no physical master FK.
5. `pending_item_creation`: steward workflow, no canonical ID until resolution.
6. `approved_free_text_exception`: permission plus justification; emergency/exception only.

`procurementItemIdentityService` implements these constraints, canonical snapshots and product-parent validation. Risk remains because multiple historic create/edit/import paths and the migration defaults (`approved_free_text_exception`) can bypass enforcement if they do not call the service. Pending resolution can update the original line to existing Generic/Product and catalogued status; `new_generic_draft` cannot finish linking until activation, which is appropriate but needs a follow-up queue state.

## 5. Procurement, stock and inventory identity

The [traceability report](phase5a-transaction-item-traceability.md) records the exact connection gaps. PO/GR/inventory schemas recognize Generic/Product/Catalog, but current connected writers omit them. Receipt resolves the first Stock Item matching a request Generic, an ambiguous Generic-only heuristic. Stock Items are therefore a mixture of canonical warehouse records and legacy/exception independent records. Multiple Stock Items may validly share a Generic when Product, UOM, institute or policy differs; unexplained duplicates are not intentional.

For batch/serial/expiry/recall-controlled healthcare items, exact Product mapping must be mandatory before inventory posting. Existing allocation tracking can then support product-level recall. For low-risk interchangeable goods, Generic-only stock remains reasonable.

## 6. Product, manufacturer, brand and identifiers

Approved Products model manufacturer, normalized MPN, package, UOM, technical and regulatory data correctly. `manufacturer_id` is authority; manufacturer text is compatibility display. Normalized-name uniqueness detects exact normalized duplicates but cannot equate BD/B.D./Becton Dickinson; aliases exist but lack a governed resolution writer. No automatic merge is recommended.

Legacy `brand_name`, `item_brands` and `stock_items.brand` mix brand, family and manufacturer display. The normalized hierarchy has no brand entity. Profile first; if governed brand/family materially improves selection, add it under canonical Manufacturer rather than treating it as an alias.

MPN is manufactured-product identity; supplier code is offer identity; GTIN/UDI/barcode are external identifiers; internal item code is Generic identity. Current regulatory JSON can retain external IDs but does not enforce type, issuer, check digit, uniqueness or effective dates.

## 7. Category and UOM authority

`category_id` and controlled `item_categories` should become authority. `generic_items.category`, legacy category, procurement/contract/supplier category text remain snapshots/search facets only. The same rule applies to UOM IDs versus `base_uom`, `inventory_uom`, `purchasing_uom`, legacy unit strings and catalog purchasing UOM.

Conversion logic is duplicated across legacy `item_conversion`, `item_uom_conversions`, Generic JSON rules, Product conversion factor, Catalog conversion factor and service calculations. Target hierarchy is base EA → product BOX (100 EA) → supplier CASE (10 BOX/1000 EA), with exact-decimal and dimensional validation. No UOM behavior changes in this batch.

## 8. Duplicate detection, merge and lifecycle

Generic creation uses deterministic fingerprint equality plus exact normalized name/category/type/UOM; structured candidate scores are 1.0/0.8 and human decisions are recorded. Category-specific parsers/fingerprint utilities cover some pharmaceutical, vascular, suture and lab attributes, but the generic foundation does not demonstrate a complete category schema for strength, form, gauge, volume, dimensions, material, sterility and concentration. Future order: deterministic exact match + structured similarity + optional AI suggestion + steward decision. AI is never authority.

Merge is proposal-only. A future transactional completion must analyze/update current references in Products, requests, stock, PO, GR, movements, warehouse projections, aliases, legacy mappings, duplicate reviews and pending resolutions; preserve historical readability; retire the source; never delete it. Generic activation blocks unresolved source-side duplicate candidates. Lifecycle permissions exist, but `item-master.approve` is referenced by controller and absent from the foundation migration's permission inserts—a critical deployment/configuration defect. Active Generic edits/revisions and material Product changes lack explicit versioning policy.

## 9. Pending-item workflow

Submission and steward queue endpoints exist. Resolution supports existing Generic/Product/Catalog, new draft, free-text exception, rejection and needs information. For existing identities, the service locks and re-links the originating requested line. Gaps: requester forms do not uniformly create pending records; supplier-catalog-only semantics still resolve through Product/Generic; new drafts need later re-link orchestration; UI must make exceptions and unresolved lines unmistakable.

## 10. Supplier catalog, contract and price authority

Catalog correctly requires an approved Product and stores supplier offer/UOM/MOQ/lead-time facts. Treat `unit_price` as **reference/list price**. RFx awarded quotation, contract-line price, award and PO snapshot remain transaction/commercial authorities in that order according to their governed source. Never reprice an award from a mutable catalog row.

`supplier_catalog_items.contract_id` references a contract header, but no line FK or proof that catalog price equals contract-line price exists. `contract_items` uses free-text/item IDs rather than verified Generic/Product/Catalog FKs. Connect the existing module at line level later; do not rebuild it.

The [writer audit](phase5a-item-writer-boundaries.md) enumerates JavaScript `Number`/`parseFloat` precision debt in item catalog, legacy cost, UOM pricing and Phase 4 price/totals. Catalog numeric validation is an authoritative violation requiring exact-decimal correction in the implementation batch.

## 11. Name identity, writers and runtime DDL

The [name-debt register](phase5a-name-based-identity-debt.md) identifies operational name matching in legacy stock creation, warehouse supply, request stock mapping, P2P warehouse joins, planning/dispensing and contract entry. Search/display uses are acceptable; operational identity resolution is high-priority debt.

The [writer/runtime audit](phase5a-item-writer-boundaries.md) finds canonical foundation writers, active legacy Item Master writers, governed and exception Stock Item writers, and missing reference-master writers. `ensureItemMasterTables` remains reachable and owns legacy/reference DDL despite migration 001–006. Other reachable item-related ensures cover requested-item UOM/approval/financial/receipt fields, recalls, monthly dispensing, warehouse supply and stock requests. Ultimately schema must be migration-owned.

## 12. Frontend and permissions

The [UI map](../../../purchase-frontend/docs/phase5a-item-master-ui-map.md) covers Item Master, Stock Mapping, PR forms, RFx, contracts, warehouse, catalog and pending queue. Users can still type arbitrary transaction and legacy-master names. No dedicated controlled manufacturer/category/UOM stewardship UI was found.

Actual permissions: `item-master.create`, `.edit`, `.validate`, `.retire`, `.map`, `.products`, `.products.approve`, `.suppliers`, `.legacy-maintain`, `.free-text-exception`, `item-master.stock-map`, `.stock-map.override`, and `inventory.add-from-master`. Generic activation checks nonexistent/unseeded `item-master.approve`. Legacy Item Master routes are materially broader than normalized routes. Merge shares `.map`; no completion permission exists because no completion exists.

## 13. Diagnostics and critical defects

Manual, read-only diagnostics are in `sql/manual/007_phase5a_item_master_diagnostics.sql`. They report master counts, mapping gaps, duplicates, missing reference/canonical FKs, lifecycle inconsistencies and governance queues. The file contains SELECTs only and was not executed.

Critical next-batch defects:

* Phase 4 canonical Product/Catalog identity is not propagated PO → GR → inventory; receipt selects an arbitrary Generic-matched Stock Item.
* Active duplicate `item_master_items` writer and exception Stock Item writer allow parallel identity.
* Some request paths/defaults can admit ordinary free text without proven service-layer governance.
* Contract lines lack canonical line identity; catalog header contract link cannot establish price authority.
* Runtime DDL remains reachable and foundation reference schema has code/schema naming inconsistencies (for example repository reads `name`/`uom_id` while migration/runtime tables use `category_name`, `manufacturer_name`, `product_uom_id`).
* Generic activation permission is referenced but not seeded by the foundation migration.
* Catalog and related authoritative monetary operations use binary floating-point.

## 14. Derived implementation sequence

1. **5A.1 Baseline contract and writer containment:** verify deployed columns/permissions; fix schema-name mismatches; migrate reference/legacy DDL ownership; seed the existing activation permission; instrument/freeze new legacy identity while preserving reads.
2. **5A.2 Reference and UOM authority:** govern Category/Manufacturer/UOM writers and aliases; establish ID authority; consolidate conversion evaluation with exact decimals while retaining compatibility text.
3. **5A.3 Legacy and stock stewardship:** run reviewed diagnostics; map legacy masters and exception stock rows to Generic/Product only with evidence; define valid multiple-stock rules; no mass inference.
4. **5A.4 Request catalog enforcement:** route every PR create/edit/import path through existing modes; connect pending submission and post-activation re-link; restrict free-text exception to existing permission and audit.
5. **5A.5 Product/catalog and commercial connection:** close Product lifecycle immutability; type external identifiers; connect supplier catalog to contract lines; label catalog price reference-only; preserve RFx/contract/award authority.
6. **5A.6 Transaction traceability:** explicitly capture awarded Product/Catalog; copy IDs through PO and GR; deterministically choose/create compatible Product-level Stock Item; post canonical IDs into movement/allocation facts without redesigning Phase 4.
7. **5A.7 Duplicate and merge governance:** expand category fingerprints, add deterministic/similarity queues, implement transactional non-destructive survivorship and audit after all FK consumers are mapped.
8. **5A.8 Retire compatibility writers/runtime DDL:** after coverage gates and regression evidence, disable legacy create/update paths and remove ensures; retain aliases, mappings and historical snapshots.