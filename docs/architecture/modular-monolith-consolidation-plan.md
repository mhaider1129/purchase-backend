# Purchase Tracker – Modular Monolith Consolidation & Refactoring Plan

## 1) Inspection summary

### 1.1 Backend structure (current)
- Monolithic Express app with route-level modules mounted under `/api/*` in `app.js`.
- Feature code split mostly by route/controller files (`routes/*.js`, `controllers/*Controller.js`) plus supporting services and schema-ensure utilities.
- Dynamic schema bootstrap pattern is used (`utils/ensure*Tables.js`) for many domains (P2P, finance core, warehouse inventory, transfers, plans).
- Procure-to-pay has a dedicated controller/service/persistence split (`procureToPayController`, `procureToPayService`, `procureToPayPersistenceService`).

### 1.2 Frontend structure (current)
- React app with route-heavy `App.js` and page-per-feature under `src/pages`.
- API layer under `src/api/*` mirrors backend route groups.
- P2P is represented by multiple pages: dashboard, lifecycle, PO, GRPO, invoice, matching, AP, payments, document flow.
- Both global (`/procure-to-pay/*`) and request-scoped (`/requests/:requestId/procure-to-pay/*`) page routes are present for many P2P functions.

### 1.3 Current modules/features detected
- Master data: suppliers, stock items, departments/sections, warehouses, projects, roles/permissions.
- Request & approval: requests, requested items, approvals, approval routes, audit logs, attachments.
- Procurement execution: procurement assignment, RFX portal, contracts, procurement plans, purchase orders.
- Receiving/warehouse intake: goods receipts, warehouse supply, warehouse inventory, warehouse transfers, dispensing, recalls.
- Finance/AP: invoices, matching, AP vouchers, payables, payments, finance postings, commitment ledger, GL postings.
- Asset/custody: custody issue and approvals.
- Supplier performance: supplier evaluations, SRM scorecards/issues/compliance.
- Reporting: dashboard/lifecycle/workload/reporting pages.

### 1.4 Current procure-to-pay structure
- Lifecycle modeled in `procurement_lifecycle_states` + history.
- Main documents/tables: `purchase_orders`, `goods_receipts`, `supplier_invoices`, `invoice_match_results`, `ap_vouchers`, `ap_payables`, `payment_records`, `document_flow_links`.
- Backend routes support document-creation and read APIs, but include both request-scoped and global entry points.
- Frontend has both request-specific lifecycle pages and global list/action pages.

### 1.5 Current overlaps and duplication risks
- Dual routing patterns for same capabilities (global + request-scoped in frontend and backend).
- Supplier identity mixed as canonical FK and free-text (`supplier_id` and `supplier_name`/`supplier`).
- Supplier evaluation linkage can degrade to name-based joins instead of FK joins.
- Status vocabularies vary by domain (`Approved/Rejected/Pending`, `PO_*`, `OPEN/PAID`, lowercase/uppercase variants).
- Warehouse-related domains overlap (`warehouse_supply_*`, `goods_receipts`, `warehouse_stock_*`) without a single intake ownership map.

---

## 2) Module inventory matrix

| Feature / Area | Purpose | Main tables | Main routes | Main pages | Owner module (target) | Overlaps with | Recommendation |
|---|---|---|---|---|---|---|---|
| Suppliers | Supplier master registry | `suppliers` | `/api/suppliers` | `SuppliersPage`, P2P invoice selectors | **Master Data** | SRM, supplier evaluations, PO/invoice supplier fields | **Keep + enforce canonical FK** |
| Supplier SRM | Operational relationship mgmt | `supplier_scorecards`, `supplier_issues`, `supplier_compliance` (controller-managed) | `/api/supplier-srm` | `SupplierSrmPage` | **Supplier Performance** | Suppliers master | **Keep; reference supplier_id only** |
| Supplier evaluations | Supplier KPI/performance scoring | `supplier_evaluations` | `/api/supplier-evaluations` | `SupplierEvaluationsPage`, dashboard pages | **Supplier Performance** | Suppliers master | **Refactor joins from name->id** |
| Stock item master | Item catalog | `stock_items` | `/api/stock-items`, `/api/maintenance-stock` | `ItemMasterPage`, maintenance pages | **Master Data** | Warehouse inventory, requested items | **Merge duplicated item management endpoints** |
| Departments/sections | Org structure | `departments`, `sections` | `/api/departments` | forms using departments/sections | **Master Data** | Warehouse issues/reporting | **Keep** |
| Warehouses | Warehouse master | `warehouses` | `/api/warehouses` | warehouse pages | **Master Data** | Warehouse intake/inventory | **Keep** |
| Requests | Purchase/service request capture | `requests`, `requested_items`, `request_logs` | `/api/requests`, `/api/requested-items` | request form pages, assigned/open/closed pages | **Request & Approval** | Procurement execution, warehouse, finance | **Keep; isolate orchestration boundaries** |
| Approvals | Approval decision workflow | `approvals`, approval history tables | `/api/approvals`, `/api/approval-routes` | `ApprovalsPanel`, `ApprovalHistory` | **Request & Approval** | Requests, non-PO receipt approvals | **Refactor status dictionary normalization** |
| Attachments | Document links | `attachments` (+item/contract columns) | `/api/attachments` | upload/download surfaces | **Request & Approval** | Contracts, requested items | **Keep; enforce attachment-owner metadata** |
| Procurement plans | Planned procurement and variance | `procurement_plan_*` | `/api/procurement-plans` | `ProcurementPlansPage` | **Procurement Execution** | Requests, stock planning | **Keep** |
| RFX portal | Sourcing and quotation award | `rfx_*` + PO creation path | `/api/rfx-portal` | `RfxPortalPage` | **Procurement Execution** | Purchase orders | **Refactor to PO service boundary** |
| Purchase orders | Issue PO documents | `purchase_orders`, `purchase_order_items` | `/api/procure-to-pay/purchase-orders` | `ProcureToPayPurchaseOrdersPage` | **Procurement Execution** | Suppliers, request items | **Keep; remove duplicate route variants** |
| Goods receipts (GRPO) | Receive against PO/request | `goods_receipts`, `goods_receipt_items`, `non_po_receipt_approvals` | `/api/procure-to-pay/*receipts*` | `ProcureToPayGoodsReceiptsPage`, lifecycle form | **Receiving & Warehouse Intake** | Warehouse inventory, request approvals | **Keep; centralize intake event model** |
| Warehouse supply | Non-PO internal supply fulfillment | `warehouse_supply_items`, `warehouse_supplied_items` | `/api/warehouse-supply`, templates | warehouse supply pages | **Receiving & Warehouse Intake** | Goods receipts, stock movements | **Merge intake semantics with GRPO model** |
| Warehouse inventory | On-hand and movements | `warehouse_stock_levels`, `warehouse_stock_movements` | `/api/warehouse-inventory` | `WarehouseInventoryPage` | **Receiving & Warehouse Intake** | Goods receipt posting, warehouse supply issues | **Keep; make it single stock source of truth** |
| Warehouse transfers | Inter-warehouse transfer requests | `warehouse_transfer_*` | `/api/warehouse-transfers` | transfer pages/components | **Receiving & Warehouse Intake** | inventory movements | **Keep** |
| A/P invoice | Supplier invoice capture | `supplier_invoices`, `invoice_items` | `/api/procure-to-pay/*invoices*` | `ProcureToPayInvoicesPage`, lifecycle invoice section | **Finance / Accounts Payable** | Suppliers, PO, GRPO | **Keep; strict supplier_id + document refs** |
| Invoice matching | 2/3-way control | `invoice_match_results` | `/api/procure-to-pay/invoice-matching-queue`, `/match` | `ProcureToPayMatchingPage` | **Finance / Accounts Payable** | PO/GRPO/invoice docs | **Keep; normalize statuses and reasons model** |
| Accounts payable | Liability recognition | `ap_vouchers`, `ap_voucher_lines`, `ap_payables`, `finance_postings` | `/api/procure-to-pay/accounts-payable`, voucher/verify/post | `ProcureToPayAccountsPayablePage` | **Finance / Accounts Payable** | Budget control, payments | **Keep** |
| Payments | Payment execution/allocation | `payment_records`, `payment_allocations` | `/api/procure-to-pay/payments`, payable payment route | `ProcureToPayPaymentsPage` | **Finance / Accounts Payable** | AP payables | **Keep** |
| Budget control | Budget envelopes + commitments | `budget_envelopes`, `commitment_ledger`, `gl_postings` | finance services + P2P hooks | lifecycle panels/reports | **Budget Control** | AP posting and PR/PO controls | **Keep; formalize budget checks at PR/PO/Invoice gates** |
| Custody/asset | Issuance and approvals | `custody_*` | `/api/custody` | custody pages | **Asset / Custody** | Warehouse issue/outbound stock | **Keep; consume stock movement events** |
| Reporting/analytics | Dashboards and operational analytics | derived/read models + existing tables | `/api/dashboard`, P2P dashboard/document flow | `Dashboard`, `LifecycleAnalytics`, `WorkloadAnalysis`, P2P dashboard pages | **Reporting / Analytics** | All modules | **Refactor to read-model projections** |

---

## 3) Source-of-truth matrix

| Business object | Canonical owner module | Canonical table(s) | Reference-only modules |
|---|---|---|---|
| Supplier | Master Data | `suppliers` | Procurement Execution, Finance/AP, Supplier Performance, Reporting |
| Item | Master Data | `stock_items` (catalog), `requested_items` (transactional line) | Receiving/Warehouse, Procurement Execution, Budget, Asset/Custody |
| Department | Master Data | `departments` | Request & Approval, Warehouse, Reporting |
| Section | Master Data | `sections` | Warehouse, Request forms |
| Request | Request & Approval | `requests` + `requested_items` | Procurement Execution, Receiving, Finance/AP, Budget, Reporting |
| Approval | Request & Approval | `approvals`, `approval_routes`(+history) | Request pages, non-PO intake flow, reporting |
| Purchase order | Procurement Execution | `purchase_orders`, `purchase_order_items` | Receiving/Warehouse Intake, Finance/AP, Reporting |
| Goods receipt | Receiving & Warehouse Intake | `goods_receipts`, `goods_receipt_items` | Finance/AP matching, inventory, supplier performance, reporting |
| Invoice | Finance/AP | `supplier_invoices`, `invoice_items`, `invoice_match_results` | Procurement Execution(read), Reporting |
| Payable | Finance/AP | `ap_payables`, `ap_vouchers`, `ap_voucher_lines` | Budget, Reporting |
| Payment | Finance/AP | `payment_records`, `payment_allocations` | Reporting, closure workflow |
| Budget | Budget Control | `budget_envelopes`, `commitment_ledger` | Request, Procurement, Finance/AP |
| Asset | Asset/Custody | `custody_*` (existing custody tables) | Warehouse issue, Reporting |
| Supplier scorecard | Supplier Performance | `supplier_scorecards` (SRM) + `supplier_evaluations` | Procurement Execution, reporting |

**Ownership rules**
- Only owner module writes canonical object core fields.
- Other modules store FK references and optional denormalized read columns only (for reporting/search), updated by event/document projection.
- Free-text reference fields (`supplier_name`, etc.) should become derived/denormalized copies, not identity keys.

---

## 4) End-to-end business flow redesign

## Primary flow (normalized)
1. **Purchase Request (PR)** – Request & Approval owns `requests/requested_items`.
2. **Approval** – Approval engine produces approved PR.
3. **Purchase Order (PO)** – Procurement Execution issues PO against approved PR and selected supplier (`supplier_id`).
4. **Goods Receipt PO (GRPO)** – Receiving captures receipt against PO lines; emits stock intake event and discrepancy records.
5. **A/P Invoice** – Finance/AP captures supplier invoice referencing PO/GRPO.
6. **Accounts Payable** – Match result + verification creates payable/liability.
7. **Payment** – Finance records payment and allocates against payable.
8. **Closure** – request lifecycle and document flow mark closed when balances are cleared and required downstream checks complete.

## Cross-module linkages
- **Budget Control**: reserve at approval/PO, consume at invoice/AP posting, reconcile at payment/closure.
- **Warehouse**: GRPO posts to `warehouse_stock_levels/movements`; custody/issues consume the same stock source.
- **Asset/Custody**: when request type requires capitalization/custody, create custody record from received+issued items.
- **Supplier Performance**: feed delivery quality/timeliness/mismatch outcomes into scorecards/evaluations.
- **Reporting**: consume `document_flow_links` + module events to build lifecycle and KPI read models.

## Document-driven architecture for finance (inside same monolith)
- Keep finance in same service boundary but process downstream states from documents/events:
  - `PO_ISSUED`
  - `GRPO_POSTED`
  - `AP_INVOICE_SUBMITTED`
  - `INVOICE_MATCH_VERIFIED/EXCEPTION`
  - `AP_PAYABLE_POSTED`
  - `PAYMENT_ALLOCATED`
- Persist immutable business documents and link them via `document_flow_links` as the chain-of-evidence.

---

## 5) Duplication analysis

### 5.1 Duplicate/parallel route surfaces
- Backend P2P has both generic and request-scoped create PO routes (`POST /purchase-orders` and `POST /requests/:requestId/purchase-orders`).
- Frontend has both global and request-scoped routes for receipts/invoices/PO/matching/AP/payments/document-flow.
- Risk: drift in behavior/validation and duplicated page state handling.

### 5.2 Duplicate identity representation
- Supplier identity appears both as FK and free-text across PO/invoice/payable (`supplier_id`, `supplier_name`, `supplier`).
- Risk: inconsistent supplier-level reporting and broken linkage if names change.

### 5.3 Duplicate status dictionaries
- Requests/approvals use title-case strings (`Approved`, `Pending`, `Rejected`) while P2P uses enum-like uppercase states (`PO_ISSUED`, `MATCH_PENDING`) and AP uses `OPEN/PAID` etc.
- Risk: fragmented transitions, hard-to-maintain reporting and filters.

### 5.4 Duplicate UI entry points
- Same functional pages mounted under two URL hierarchies (global and request-scoped) without an explicit single mode contract.
- Risk: state/query duplication and user confusion.

### 5.5 Duplicate business logic hotspots
- Supplier lookup/creation logic appears in multiple flows (invoice/PO pages and controllers).
- Warehouse intake logic split between GRPO and warehouse-supply pathways.

### 5.6 Repeated reference data
- Item names used as joins in operational flows (matching stock item by `LOWER(name)` style joins) can duplicate semantic identity.

### 5.7 Mismatched ownership
- Supplier performance links can still rely on name-based correlation instead of supplier FK.
- Finance lifecycle updates and request status updates can diverge if not normalized to one orchestration path.

---

## 6) Refactoring roadmap (phased)

### Phase 1 – Structure & ownership cleanup
- Introduce explicit module folders (modular monolith boundaries):
  - `modules/master-data`
  - `modules/request-approval`
  - `modules/procurement-execution`
  - `modules/receiving-warehouse`
  - `modules/finance-ap`
  - `modules/budget-control`
  - `modules/asset-custody`
  - `modules/supplier-performance`
  - `modules/reporting-analytics`
- Add boundary README + ownership contract per module.
- Keep existing route URLs stable; refactor internals only.

### Phase 2 – Route and service consolidation
- Standardize P2P command routes to request-scoped writes, global read lists.
- Create unified orchestrator services:
  - `supplierReferenceService` (resolve supplier_id and denorm fields)
  - `documentFlowService` (document link writes)
  - `lifecycleTransitionService` (single transition authority)
- Add deprecation headers for duplicate endpoints.

### Phase 3 – Frontend page consolidation
- Keep one page component per function; add mode (`global`/`request`) via URL params and shared hooks.
- Consolidate duplicated route declarations using route generators.
- Promote shared hooks (`useSuppliers`, `useProcureToPayFilters`, `useDocumentFlow`).

### Phase 4 – Status normalization
- Publish canonical enum maps for request/approval/procurement/ap/payment.
- Add translation tables for legacy values.
- Migrate filters and writes to canonical enums.

### Phase 5 – Module integration improvements
- Enforce FK-first references (supplier/item/request) in write paths.
- Emit module events/documents to drive downstream updates (inventory, AP, scorecards, reporting).
- Add cross-module integration tests for end-to-end flow.

### Phase 6 – Cleanup/deprecation/removal
- Remove duplicate routes/pages after telemetry confirms no usage.
- Drop legacy columns/derived fields where safe.
- Remove name-based joins and fallback status values.

---

## 7) Implementation plan (exact, implementation-ready)

## 7.1 Files to create
1. `purchase-backend/modules/*` boundary scaffolds with `README.md` and `index.js` for each target module.
2. `purchase-backend/services/supplierReferenceService.js`
3. `purchase-backend/services/documentFlowService.js`
4. `purchase-backend/services/lifecycleTransitionService.js`
5. `purchase-backend/constants/statusCatalog.js`
6. `purchase-frontend/src/hooks/useProcureToPayContext.js`
7. `purchase-frontend/src/hooks/useProcureToPayNavigation.js`
8. `purchase-frontend/src/constants/statusCatalog.js`

## 7.2 Files to edit
- Backend
  - `purchase-backend/routes/procureToPay.js` (deprecate duplicate write routes; keep compatibility wrappers)
  - `purchase-backend/controllers/procureToPayController.js` (delegate supplier/doc/lifecycle logic)
  - `purchase-backend/controllers/suppliersController.js` (remove name-only correlation in dashboard queries)
  - `purchase-backend/controllers/supplierEvaluationsController.js` (introduce supplier_id-based ownership)
  - `purchase-backend/services/procureToPayPersistenceService.js` (standardize supplier refs)
  - `purchase-backend/utils/ensureProcureToPayTables.js` (add constraints/indexes for canonical references)
- Frontend
  - `purchase-frontend/src/App.js` (route consolidation helpers)
  - `purchase-frontend/src/pages/ProcureToPay*.jsx` (shared context/hook usage)
  - `purchase-frontend/src/api/procureToPay.js` (normalize API surface)

## 7.3 Tables to merge/extend (minimal-breaking strategy)
- Extend, do not break immediately:
  - `supplier_invoices`: ensure `supplier_id` NOT NULL for new rows, keep `supplier` as denormalized display until migration complete.
  - `purchase_orders`: keep `supplier_name` as denormalized; canonical identity = `supplier_id`.
  - `supplier_evaluations`: add/standardize `supplier_id`; backfill from name lookup.
- Add normalization assets:
  - `status_dictionary` (optional) or code enum map + DB CHECK constraints.

## 7.4 Routes to keep/remove
- Keep (canonical):
  - Request-scoped write commands (`/requests/:requestId/...`) for PO/GRPO/invoice/match/verify/post/payment transitions.
  - Global read/query routes for dashboards and lists.
- Deprecate/remove (after transition window):
  - Duplicate non-request-scoped command routes such as `POST /purchase-orders` if equivalent request-scoped command exists.

## 7.5 Pages to consolidate
- Consolidate each P2P function into one component with mode param:
  - PO, GRPO, Invoice, Matching, AP, Payments, Document Flow.
- Keep lifecycle page as request orchestration center.

## 7.6 Services to centralize
- `supplierReferenceService`: single supplier resolve/upsert policy.
- `documentFlowService`: all document link writes.
- `lifecycleTransitionService`: all state transition checks and writes.
- `statusCatalog`: common status constants + mapping helpers used by backend and frontend.

---

## 8) Code changes in this iteration

This iteration produces planning artifacts only (no functional behavior changes), to enable safe phased implementation:
- Added this consolidation/refactoring plan document.
- Added module ownership manifest with boundaries and ownership rules.

(See `docs/architecture/module-boundary-manifest.yaml`.)

---

## 9) Testing checklist (for implementation phases)

## 9.1 Backend
- Unit tests
  - lifecycle transitions and invalid transition guards
  - supplier reference resolution (id, name fallback, duplicate names)
  - document flow link creation for each command
- Integration tests
  - PR -> Approval -> PO -> GRPO -> Invoice -> AP -> Payment -> Closure
  - Budget check gates at PR/PO/invoice/AP posting
  - Inventory movements after GRPO and issue/custody
- Contract tests
  - backward compatibility for deprecated routes until removal date

## 9.2 Frontend
- Route tests: global vs request mode renders same page logic
- Hook tests: `useSuppliers`, `useProcureToPayContext` data loading and error states
- E2E: full P2P happy path + mismatch/exception path

## 9.3 Data migration validation
- supplier_id backfill completeness report
- status normalization mapping report
- name-based join elimination report

---

## 10) Backward compatibility notes

- Keep all existing external route contracts during transition; mark deprecated endpoints with response headers and logs.
- Keep denormalized display columns (`supplier`, `supplier_name`) as read-model convenience until consumers are migrated.
- Add non-breaking defaults and backfill scripts before enforcing NOT NULL/strict CHECK constraints.
- Use feature flags for frontend route consolidation to avoid sudden navigation breakage.