# Development requested-item and inventory identity hardening

**MANUAL DATABASE MIGRATION REQUIRED.** The owner must execute the two Development SQL files below before deploying this release to Development. No SQL was executed against Supabase, no Production connection was made, and no Production migration or configuration change was produced. The integration tests use a new disposable local PostgreSQL database, never the connected Development database.

## A. Summary

New demand uses one backend validator and normalizer. Omitted mode on description-only demand becomes `free_text / pending_mapping`; omitted mode with master IDs is rejected. Non-Stock is a stocking decision independent of catalog identity. The form preserves all seven modes through draft save/load and submission. Initial creation and later additions have controller-level parity tests.

Request edits update the same requested-item IDs, preserving stored identity and snapshots unless an explicit authorized identity change passes validation. Attachments and downstream FK references are retained. Duplicate/foreign IDs, omission/replacement of existing lines, and changes to lines already referenced by procurement are rejected. New line IDs are returned to edit screens. Approval-staged edits use the same writer, and Date serialization does not reclassify legacy identity.

Unresolved/legacy lines are blocked at sourcing, quotation, award, PO conversion, purchase event, and legacy purchase-progress entry points. Closing/canceling unprocured demand remains available. Governed resolution uses the same validator, clears obsolete product restrictions, preserves original wording, and records commercial catalog provenance in audit context rather than Stock Item identity.

Receipt Stock Item selection now uses immutable PO identity, inventory UOM and configured warehouse scope. Ambiguity is an error, with no arbitrary first-row selection. Employee Tasks performs a read-only capability check and DML; its table is deployed by a versioned SQL file.

## B. Files changed

Paths are relative to the repository root. Historical migration files and the exported schema snapshot are not rewritten. This file is also part of the change.

| File | Purpose / important behavior |
| --- | --- |
| `purchase-backend/services/procurementItemIdentityService.js` | Authoritative seven-mode validation, explicit new-demand normalization, identity field list, readiness predicate, and governed resolution writes. |
| `purchase-backend/services/requestedItemWriteService.js` | Shared add/import/edit persistence; retain IDs/snapshots, reject replacement and consumed-line changes, create/audit pending referrals, return persisted IDs. Uses checked-in columns; no nonexistent requested-item `item_type` write. |
| `purchase-backend/controllers/requests/createRequestController.js` | Every new applicable line uses central normalization and shared pending/exception auditing, including omitted modes. Warehouse Supply retains its separate demand table. |
| `purchase-backend/controllers/requestedItemsController.js` | Add-item contract parity; reject invalid items; retain reasons, dates and UOM; unresolved demand cannot acquire purchase progress. |
| `purchase-backend/controllers/requests/updateRequestsController.js` | Preserve submitted IDs/identity, prepare staged edits, update rows through shared writer, return new IDs. |
| `purchase-backend/controllers/approvalsController.js` | Apply approved edits through the same writer instead of detaching attachments and deleting/reinserting requested items. |
| `purchase-backend/controllers/requests/historicalRequestController.js` | Historical inserts explicitly retain NULL mode/status rather than relying on database defaults. |
| `purchase-backend/controllers/requests/fetchRequestsController.js` | Detail and item reads return stored identity fields, including legacy NULLs, without inferred approval. |
| `purchase-backend/controllers/requests/procurementItemEventsController.js` | Central insertion for warehouse bridges; readiness required before a purchase event; unresolved bridge transactions roll back. |
| `purchase-backend/services/sourcingReadinessService.js` | Uses the central predicate; NULL is unclassified and blocks sourcing. |
| `purchase-backend/services/rfxResponseService.js` | Reject unresolved requested items before accepting quotation lines. |
| `purchase-backend/services/procurementAwardService.js` | Validate locked requested-item readiness before creating an award. |
| `purchase-backend/services/purchaseOrderService.js` | Existing awards cannot bypass current requested-item readiness during PO conversion. |
| `purchase-backend/services/requestItemResolutionService.js` | Direct resolution uses central validation, approved Stock mapping, and clears obsolete restrictions; referrals retain reasons. |
| `purchase-backend/services/itemMasterFoundationService.js` | Pending resolution uses central contract; supplier-offer resolution also updates demand identity and retains the offer in audit context. |
| `purchase-backend/services/receiptStockIdentityService.js` | Resolve all approved stock candidates using Generic, optional Product, inventory UOM and configured warehouse; explicit missing/ambiguous errors. |
| `purchase-backend/repositories/connectedP2PRepository.js` | Delegate receipt resolution; include readiness in PO identity reads, require matching demand Generic, and lock the requested-item snapshot. |
| `purchase-backend/services/goodsReceiptService.js` | Validate warehouse/institute and resolve stock from immutable PO-line fields before inventory posting. |
| `purchase-backend/routes/tasks.js` | Remove runtime DDL; schema-qualified DML plus read-only table check; missing deployment returns HTTP 503 and `EMPLOYEE_TASKS_SCHEMA_MISSING`. |
| `purchase-backend/sql/development/20261005_01_requested_item_identity.sql` | Development forward migration; preflight writer columns and existing enums; seven modes/three statuses, no approval defaults, nullable historical fields. |
| `purchase-backend/sql/development/20261005_02_employee_tasks.sql` | Development table deployment/compatibility validation, owned generated IDs, exact columns/defaults, restrictive user FKs, and two indexes. |
| `purchase-backend/sql/verification/20261005_development_stock_catalog_provenance.sql` | Read-only owner diagnostic for column data, constraints, indexes, dependencies, views, functions and triggers; no removal. |
| `purchase-backend/integration/fixtures/p2p.sql` | Real identity enum CHECKs, integer requested quantity, required description, no fictitious approved-quantity/item-type columns, stock mapping status and audit support. |
| `purchase-backend/integration/p2p.postgres.test.js` | Real PostgreSQL migration repeatability/preservation/failure cases, receipt discrimination, stable-ID edits and non-mutating stock diagnostics. |
| `purchase-backend/tests/requestIdentityHardening.test.js` | Seven modes, status derivation, permissions, product ownership, reasons, legacy behavior, imports, ID retention, controlled resolution and procurement gates. |
| `purchase-backend/__tests__/createRequest.test.js` | Actual initial/add controller parity for all seven modes plus omitted-mode demand. |
| `purchase-backend/tests/requestedItemLegacyProcurementGates.test.js` | Legacy status/quantity APIs roll back unresolved purchase attempts without updating demand. |
| `purchase-backend/tests/receiptStockIdentityService.test.js` | Exact resolver inputs/query dimensions and absent, unresolved and ambiguous candidates. |
| `purchase-backend/tests/employeeTasksGovernance.test.js` | Task authorization/ownership, missing deployment and absence of API DDL. |
| `purchase-backend/__tests__/nonStockIdentityGovernance.test.js` | Physical award fixture declares legitimate catalogued identity. |
| `purchase-backend/tests/generateRfxController.test.js` | Valid catalogued sourcing fixture replaces implicit legacy authorization. |
| `purchase-backend/tests/phase4AwardEligibilityCorrection.test.js` | Legitimate service fixture for supplier/award eligibility checks. |
| `purchase-backend/tests/phase4ConnectedP2P.test.js` | Explicit service/catalogued fixtures preserve meaningful award/PO regression checks. |
| `purchase-backend/tests/phase5a2UomAuthority.test.js` | Controlled catalogued and justified exception fixtures for UOM/PO behavior. |
| `purchase-backend/tests/rfxIdentityCorrection.test.js` | Explicit service quotation and catalogued PO fixtures for existing RFx/PO identity regressions. |
| `purchase-backend/tests/procurementItemEventsController.test.js` | Governed event fixture; unresolved warehouse bridge rolls back instead of becoming automatically approved. |
| `purchase-backend/tests/updateRequestBeforeApproval.test.js` | Staged maintenance edit carries an existing ID and retains legacy NULL identity. |
| `purchase-frontend/src/utils/requestItemIdentity.js` | Frontend seven-mode status mapping, identity-preserving new-demand payloads and stable-ID helper. Backend remains authoritative. |
| `purchase-frontend/src/utils/requestItemIdentity.test.js` | Status/identity preservation and stable-ID regression tests. |
| `purchase-frontend/src/components/requests/RequestItemIdentityFields.jsx` | Mode selection, approved Product choices, reasons and date; unauthorized exception option hidden; switching modes clears stale physical IDs. |
| `purchase-frontend/src/components/requests/RequestItemIdentityFields.test.jsx` | Permission, service, preference and active approved Product UI behavior. |
| `purchase-frontend/src/pages/requests/NonStockRequestForm.jsx` | Preserve identity in draft/submit; use identity component; description-only defaults remain unresolved. |
| `purchase-frontend/src/pages/OpenRequestsPage.jsx` | Carry existing item IDs, prevent removal of persisted lines, and retain server-generated new IDs. |
| `purchase-frontend/src/pages/MyMaintenanceRequests.jsx` | Carry stable IDs, prevent persisted-line removal, retain canonical IDs and keep current items while SCM reviews a staged edit. |
| `purchase-backend/docs/architecture/development-identity-hardening-20261005.md` | Full implementation report, authoritative contract and manual deployment/recovery checklist. |

## C. Authoritative requested-item contract

The server authority is `services/procurementItemIdentityService.js`. Client status input cannot override derived status on new/explicitly reclassified demand. Product IDs must resolve to active approved Products belonging to the selected active Generic Item.

| request_mode | Required identity / authority | catalog_status | Active procurement |
| --- | --- | --- | --- |
| `generic_item` | Active `generic_item_id`; neither preferred nor mandatory Product | `catalogued` | Eligible subject to normal approvals/sourcing controls |
| `generic_item_with_preference` | Active Generic + `preferred_product_id`; optional preference reason; no mandatory Product | `catalogued` | Eligible; preference stays optional |
| `specific_approved_product` | Active Generic + `mandatory_product_id` + `restriction_justification` | `catalogued` | Eligible; mandatory restriction is intentional |
| `free_text` | Description; no physical master IDs; cannot declare itself stocked | `pending_mapping` | Blocked pending explicit resolution |
| `pending_item_creation` | Description and pending-item/restriction justification; no physical master IDs | `pending_mapping` | Blocked pending explicit resolution |
| `approved_free_text_exception` | `item-master.free-text-exception` authority + explicit restriction justification; no physical master IDs | `approved_exception` | Eligible under controlled exception governance |
| `service` | Service description; no physical master IDs; service stocking policy | `approved_exception` | Eligible under normal service/approval controls |

Omitted/blank mode with no IDs becomes unresolved `free_text`, never an exception. Omitted mode with IDs and unknown modes are rejected. Historical NULL means legacy/unclassified, not an approved exception. Non-Stock controls stocking behavior and cannot grant catalog authority. Catalogued physical awards still require offered Product and commercial Supplier Catalog provenance. Eligibility is not itself request, PO or payment approval.

## D. Database migrations

**These files have NOT been applied to Development or Production.** They are manual forward migrations, not a schema synchronization release. Use the confirmed Development project `bcvfosxcyvarieiinovo`; verify the SQL Editor project before executing anything.

1. **`purchase-backend/sql/development/20261005_01_requested_item_identity.sql`**
   - Manually run in Development before deploying the application change.
   - Prerequisites: existing `public.requested_items` with the writer columns enumerated in preflight, including deployed Item Master identity/UOM fields; mode/status are nullable text; existing non-NULL values belong to the seven-mode/three-status contract. Generic/Product master data, pending referrals and item-master audit tables are existing application prerequisites, not created by this patch.
   - Transaction: five-second lock timeout, sixty-second statement timeout, preflight, before counts, replace only the two known single-column enum CHECKs, remove mode/status defaults, COMMIT, post-verification. Unexpected/custom identity CHECKs cause a diagnostic abort rather than automatic removal. Other historical data and constraints are untouched.
   - Expected output: the two nullable text columns with NULL defaults; two validated CHECK definitions; equal before/after total row and legacy NULL counts. Seven modes include `free_text`; three statuses remain unchanged.
   - No operational data deletion/backfill/FK/ID changes. Replacing named CHECKs and removing defaults are schema changes; save their original definitions/defaults and before counts first. A preflight/validation/lock failure rolls back the transaction; issue `ROLLBACK;` if the SQL Editor session remains aborted. After success, do not blindly restore the old CHECK if new `free_text` rows exist, and do not restore defaults that authorize exceptions. Prefer correcting the forward migration with reviewed evidence; no automatic rollback script is provided.

2. **`purchase-backend/sql/development/20261005_02_employee_tasks.sql`**
   - Manually run in Development before deploying the Tasks route change.
   - Prerequisite: `public.users(id)` is an integer referenced key. For an existing task table, require exact ten-column types/nullability, ID primary key with an owned serial/identity sequence, `pending` status default and transaction timestamp defaults. Existing user references must be valid. Existing FK/index definitions must be compatible. IDs/sequences are not reset.
   - Creates the table only if absent. A compatible existing table retains tasks and IDs, and missing user FKs/indexes are added. Incompatible types/defaults/orphans/FKs/indexes abort with `DEV_TASKS_*` messages; review rather than rebuild the table.
   - Expected output: ten columns/defaults, primary key and two validated restrictive/noncascading user FKs, valid assignee/assigner indexes, row count/minimum/maximum ID and owned sequence. Preserve a pre-migration export/count/ID record. Verify runtime role table/sequence access; this patch does not change grants or RLS.
   - A failed transaction rolls back without recreating tasks. If application rollback is required, keep the compatible task table/data rather than dropping it. Repair incompatible existing definitions in a separate reviewed patch; reconcile orphans explicitly without deleting tasks.

3. **Diagnostic, not migration: `purchase-backend/sql/verification/20261005_development_stock_catalog_provenance.sql`**
   - Manually run in Development and send all result sets/notices. `BEGIN TRANSACTION READ ONLY` ends with `ROLLBACK` and changes nothing.
   - Expected output: column presence/type, populated/distinct-offer counts via notice, related constraints/indexes/catalog dependencies, view/materialized-view/function text references and stock triggers. An absent column is reported without causing a missing-column SQL error.
   - No stock-column DROP file exists. Data/provenance and actual dependencies are not yet verified, so removal remains blocked. Text/catalog scans cannot prove absence of external consumers or dynamic SQL.

The checked-in exported schema and old Phase 5A migrations remain historical evidence; they are not rewritten to imply this migration already ran. For a new bootstrap, apply existing prerequisites and this Development forward migration in order. Re-export the actual Development schema after owner execution to replace audit assumptions with evidence.

## E. Stock identity and provenance

Canonical identity is **Generic Item → optional Approved Product → Stock Item → inventory UOM**, with inventory held per warehouse. Supplier Catalog Items are commercial offers kept on sourcing, awards, POs, receipts and source provenance. They do not define Stock Item identity.

Receipt resolution uses the PO line's Generic, awarded Product and immutable inventory/base UOM, plus the receiving warehouse. The warehouse must be active and pass the existing actor institute check. A stock candidate must match Generic/UOM, have `mapped_generic` or `mapped_product` status, and be configured in `warehouse_stock_levels` for that warehouse (a zero balance qualifies). Product-specific mappings match the awarded Product; a deliberate Generic-only mapping may receive Products under that Generic. If both generic-only and product-specific candidates qualify, the result is ambiguous. No preference order is invented.

Zero candidates produces `STOCK_IDENTITY_NOT_FOUND`; multiple candidates produces `STOCK_IDENTITY_AMBIGUOUS`; missing identity produces `STOCK_IDENTITY_UNRESOLVED`. The receipt transaction rolls back before inventory is posted. Controlled mapping/Add to Inventory must supply an unambiguous, approved warehouse identity. Existing UOM conversion remains: purchasing packaging is converted through the PO snapshot; differing Generic base/inventory UOM remains blocked until a governed conversion exists.

Repository provenance was found more precisely than the earlier audit: commit **`5e18ac8b` (2026-07-28)** removes `ADD COLUMN supplier_catalog_item_id ... REFERENCES supplier_catalog_items` from `sql/migrations/phase1b/01_stock_item_identity_columns.sql` and substitutes the explicit uncoupled-identity comment. It also removes the stock catalog field/FK from the exported schema. Commit **`5b1c00c3` (2026-07-31)** contains the corresponding later history removal. Earlier definitions could explain a surviving Development column, but edits to historical files do not reverse an already applied schema. No forward removal is established by that evidence, and the exact live execution event is unknown.

No current canonical stock application writer/resolver uses that column. Live populated values, dependent objects, dynamic SQL and external consumers have not been inspected. Leave it unchanged. If useful offer provenance exists, inventory/receipt/source lineage must first be reconciled into the appropriate provenance records in a separate explicit migration, with source evidence retained; do not infer or discard historical sourcing relationships.

## F. Employee Tasks

The schema is deployed once by the owner, not by API traffic. Routes only check `to_regclass('public.employee_tasks')` and perform schema-qualified DML. Missing deployment returns HTTP 503 with a stable code. Existing SCM/COO assignment permissions and assignee ownership checks are retained. The existing user feature for deleting one's assigned task is unchanged; this change runs no operational deletion. The application has other legacy runtime schema helpers outside this focused task; their removal is not claimed here.

## G. Legacy compatibility

Historical requests remain readable with their original text, IDs, snapshots and NULL classification. Read APIs return those values without inference. Historical imports explicitly insert NULL mode/status, even if an environment still has the old database defaults. Ordinary edits retain classification; explicit identity changes must pass current validation. Legacy NULL/free-text demand needs governed resolution before new sourcing/quotation/award/PO/purchase progress.

Existing PO/receipt/invoice snapshots are not rewritten or backfilled. Normal request edits cannot replace lines or change consumed demand; users must use an appropriate controlled correction/cancellation workflow. An old pending edit payload without item IDs is rejected rather than deleting/rebuilding rows; it must be resubmitted with stable IDs. For Warehouse Supply procurement events, a pre-linked, explicitly resolved requested item is required; the legacy automatic unresolved bridge rolls back. Direct warehouse fulfillment remains separate.

`maintenance_stock` remains obsolete. The active backend/frontend search found no table dependency. Residual dead evidence remains in `sql/View_Supabase_SQL.sql` (old table definition) and `sql/UI_resource_permissions.sql` (`feature.maintenanceStock` seed metadata). Neither is restored or used as a new application dependency. Production cleanup is deferred.

## H. Test results

Commands run from the indicated application directory on 2026-10-05. The baseline backend run passed 171 suites/1,230 tests before changes; focused baseline GenericItemSelector passed 3 tests.

| Directory / command | Result | Notes |
| --- | --- | --- |
| Backend: `npm test -- --runInBand --silent` | **PASS**, 175 suites / 1,282 tests | All backend tests; controller parity, legacy procurement, identity, task and receipt regressions included. |
| Frontend: `npm test -- --runInBand` | **PASS**, 50 suites / 209 tests | Full frontend suite. |
| Backend: `npm run test:p2p-postgres` | **PASS**, 22 tests | Actual disposable PostgreSQL execution, including repeated migrations, preserved IDs/NULLs/tasks, incompatible columns, indexes, orphan insert rejection, receipt Product/UOM/warehouse discrimination and absent/populated stock diagnostic cases. |
| Frontend: `npm run build` | **PASS** | Build completes; existing lint warnings and bundle-size advisory remain. |
| Frontend: `npm run lint` | **FAIL**, 2 existing errors + 2 existing warnings | Errors in unchanged `src/pages/fixed-assets/PhysicalInventory.test.jsx`: direct node access and render-result naming. Warnings in unchanged PhysicalInventory and DepartmentRequestedItemsBoard. Their files match branch HEAD; no unrelated fix made. |
| Frontend: ESLint on the seven changed/new JS/JSX files | **PASS** | Pages OpenRequestsPage/MyMaintenanceRequests/NonStockRequestForm, RequestItemIdentityFields and its test, requestItemIdentity and its test. |
| Backend: `node scripts/validateManualSql.js sql/development/20261005_01_requested_item_identity.sql` | **PASS** | Static raw-SQL check; actual SQL execution also tested locally. |
| Backend: `node scripts/validateManualSql.js sql/development/20261005_02_employee_tasks.sql` | **PASS** | Same. |
| Backend: `node scripts/validateManualSql.js sql/verification/20261005_development_stock_catalog_provenance.sql` | **PASS** | Same; both diagnostic branches execute in PostgreSQL. |
| Root: `git diff --check` and review of added files/configuration scope | **PASS** | No whitespace errors; no secrets or Production configuration changes included. |
| Live Supabase migrations, live schema/dependency inspection, browser/API workflow against Development | **NOT RUN** | Owner applies SQL manually; no live connection/application startup performed. |
| Separate backend lint/build/typecheck | **NOT RUN / no dedicated scripts** | CommonJS backend test suite is the repository's validation target; frontend build includes its normal compilation checks. |

The fixture now enforces the target Development mode/status/mapping CHECKs and uses real integer requested quantity without a fictitious `approved_quantity` column. It remains a focused P2P fixture, not a complete clone of live Development/Production. Local passing tests cannot prove live schema synchronization, grants, RLS, external references or existing business data compatibility.

## I. Remaining risks

- Manual migrations and live verification are outstanding. Preflight may block on unknown Development drift; preserve the error and schema evidence rather than removing safeguards.
- Stock catalog removal needs live data/dependency outputs and external-consumer review. Exact live schema provenance is unconfirmed.
- Historical NULL/unresolved demand and old pending edits may now receive deliberate 409 errors until explicitly resolved/resubmitted. No bulk conversion was performed.
- New inventory identities must be mapped and configured in the receiving warehouse; multiple acceptable mappings need an explicit decision before receipt.
- A resolved Warehouse Supply procurement link is required. Automatic bridge creation no longer grants procurement eligibility; no new warehouse-to-procurement resolution UI was added in this focused change.
- Review actual runtime role access and task sequence state, and perform owner UI/API smoke tests after manual deployment. No grants/RLS or sequence resets are automatic.
- Existing repository-wide lint errors remain. New UI labels use English consistent with the touched component's existing conventions; full translation coverage is separate work.
- The reported journal/GL schema mismatch, segregation-of-duties controls, AP acceptance/posting changes and Production synchronization remain separate phases. No finance architecture was changed.

## J. Ordered owner checklist

1. Review the Draft PR and this report. Confirm **Development `bcvfosxcyvarieiinovo`** in Supabase SQL Editor; do not select Production.
2. Export/retain the current Development schema, requested-item row/NULL counts and known constraint/default definitions. If Tasks exists, retain its schema/count/IDs/sequence evidence and a task data backup.
3. Run `purchase-backend/sql/verification/20261005_development_stock_catalog_provenance.sql`. Send all result sets and notices; leave the stock supplier-catalog column unchanged.
4. Run `purchase-backend/sql/development/20261005_01_requested_item_identity.sql`. Send preflight/errors and all post-verification outputs. On an error, roll back the aborted session; do not bulk repair business data or relax the checks.
5. Run `purchase-backend/sql/development/20261005_02_employee_tasks.sql`. Send column/default/constraint/index/count/sequence outputs. Review runtime role table/sequence access. Do not rebuild existing tasks.
6. After successful reviewed outputs, deploy the reviewed application change to Development. Keep the PR Draft until the owner is satisfied with the results; merging/deployment are owner actions.
7. Test Non-Stock draft/reload/submit and adding a later line for catalogued Generic, preference, mandatory restriction, unresolved free text, pending creation, authorized exception and service. Verify ordinary users cannot approve exceptions and mode omission stays unresolved.
8. Test request edits and staged maintenance approval: item IDs, snapshots, attachments and FK lineage survive; new IDs remain usable on a subsequent edit; consumed/omitted/duplicate/foreign lines are rejected. View legacy NULL requests, then explicitly resolve one before attempting new procurement.
9. Test receipt with correct Product/UOM/warehouse, no mapping, and ambiguous mappings; rejected receipts must leave inventory unchanged. Verify task assignment/list/update/ownership after deployment.
10. Re-export the Development schema and send it with verification outputs. Only then compare against the previously captured Production audit evidence and plan a separate synchronization phase. **No Production SQL is supplied by this change.**
