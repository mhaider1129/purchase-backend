# Device demo workspace

One workspace belongs to one requested device line, with any number of company demos. It supports demonstrations during approval, evaluation evidence, comparison, selection recommendation and independent COO selection approval. It does not replace normal request approvals, departmental technical clearance, supplier eligibility or financial controls.

## Deployment

**MANUAL DATABASE MIGRATION REQUIRED**: apply `purchase-backend/sql/manual/050_device_demo_workspaces.sql` in the Supabase SQL Editor, then deploy the backend and rebuilt frontend. The additive patch creates six RLS-protected tables for workspaces, evaluators, company demos, signed reports, selection rounds and the journal. No historical requests, financials, approval routes, permissions or inventory are backfilled or changed. Reapplying preserves populated records. This assumes the repository's existing request, item-master, supplier, user, institute and notification schema is installed.

Use the existing trusted backend connection. Custom backend database roles need the appropriate table/sequence privileges and their normal trusted RLS access; the patch grants no browser access or user permissions. Do not run a separate application migration command. Implementation tests use only disposable local PostgreSQL, not Supabase/production.

The workspace is reachable from **Account → Device demo workspace** and **Device demos** on a request. Medical Devices users or holders of `approval-authority.medical-devices` can initiate at their own active, pending/on-hold, non-superseded approval step. SCM needs `requests.manage` or `technical-inspections.manage`; SCM may initiate at its active step or for approved outstanding demand. Demo coordination remains available after the approval step advances. A medical-devices initiator coordinates their own workspace; same-institute SCM can coordinate all workspaces. Assigned evaluators need an active same-institute account and current assigned department.

COO decisions require the active COO role or existing `approval-authority.coo` capability. Admin is not an implicit COO override. The COO must not be the workspace creator, recommending submitter or an assigned evaluator. An independent active COO must exist before submitting a selection. Capability-based authority follows the application's existing permission model; role/capability grants are not added automatically.

## Workflow

1. At the medical-devices/SCM approval step, open a workspace for an outstanding device. SCM can also open after request approval. Initiation is refused after a purchase, procurement event, award, PO line or financial commitment exists for that device. Requesting-department participation is required.
2. Set objectives, select the evaluation team and agree the named criteria and weights (100% total). The UI provides four editable technical/intended-use/usability/support criteria. The server supports up to 20 criteria. Criteria and the evaluator roster remain fixed for a consistent comparison.
3. Register a separate demo for each company/configuration: supplier, manufacturer/model, serial number, planned evaluation dates, trial location and description. Multiple models from the same company may be registered as separate demos. Choose an eligible same-institute supplier or an existing shared supplier (null institute).
4. For a governed requested item, select the company's approved product/catalog identity matching the requested Generic Item and any mandatory Product. Legacy approved free-text exceptions can record manufacturer/model directly while item-master setup continues.
Use **Workspace documents** to upload specification sheets, data sheets, brochures and other supporting files directly to the workspace, including before registering/receiving any company demo. Existing request files can also be linked. Files are stored using the existing authenticated request-attachment service and explicitly linked to the workspace's signed journal, with attachment actor/time, optional description and authenticated downloads. Adding a workspace file preserves unsaved evaluation/report drafts. Supporting documents can be appended during COO review or after selection; this does not rewrite the frozen comparison or signed reports. Cancelled workspaces retain downloads but accept no new documents. The underlying request-attachment retention/deletion lifecycle remains in effect; this is not an immutable blob archive.

5. Record receipt → start evaluation → complete evaluation, with notes at every step. Alternatively withdraw an unsuitable/unavailable demo with a reason. Actual milestones use server timestamps; planned dates do not automatically change trial state. Early completion/withdrawal must be explicitly documented. Record the return of completed/withdrawn received loan units separately, including after selection/cancellation.
6. Coordinators and assigned evaluators can add observations with request-attached evidence. Evaluators submit one immutable signed report per completed demo, with each criterion scored 0–5, evidence/comments, overall findings, safety findings and Suitable/Not suitable recommendation. The server computes the weighted score out of 100; submitted names, signatures and calculated scores are not trusted.
7. All demos must be completed or withdrawn, and every evaluator must report on every completed demo. The comparison shows average scores and suitability. Every evaluator must consider the chosen device suitable. A higher score does not automatically select a company: SCM/initiator records a reasoned recommendation about the best fit.
8. Submit selection to the COO. Candidate/report changes are frozen while COO review is pending. The COO approves the particular device/company, or returns the selection for revision with a reason. Previous selection rounds and signed reports remain visible. After rejection, coordinators may document further evidence, add new company/configuration demos and submit a new recommendation; existing reports cannot be rewritten.
9. Procurement of a demo-tracked device remains blocked until COO selection approval **and** normal request approval. Departmental technical clearance remains an independent requirement when configured/selected. Receiving the loan demo never marks the request purchased, received, in stock or completed.

## Procurement integrity

Only devices explicitly placed in a demo workspace are affected. The central procurement readiness check holds a transaction-scoped item lock shared with workspace changes, and checks the latest workspace for award creation, PO creation and procurement registration. Open, revision, pending-COO and cancelled workspaces do not grant clearance; cancellation cannot restore an older selection.

Every procurement command must name the COO-selected supplier. Award and PO commands for a governed item must also match the selected Product and supplier catalog. Before registering procurement of a governed demo device, a matching selected-product PO must exist. Other existing PO, quantity, supplier and financial controls still apply. Legacy quantity/status-only updates without supplier provenance cannot bypass a tracked demo: use a supplier-specific procurement event or the governed award/PO flow.

For approved free-text exception demand, the machine check binds the supplier; manufacturer/model and suitability remain documented in the trial/selection record and must be verified by procurement staff. Exact machine-enforced model binding requires a governed catalog identity. This preserves the existing temporary free-text operating mode without claiming that a text description identifies a controlled product.

Changes to requested material specifications, quantity, name, brand, unit, item/product identity or requesting department invalidate selection. Stock-fulfilled, rejected/cancelled demand and requests that have not finished normal approval cannot be purchased using a prior demo decision. Cancel and restart the workspace if requirements/evaluator roster need a new trial round; cancellation is refused once procurement/commitment has begun. Use the existing governed document-cancellation process in that situation.

Sourcing and quotations remain possible to arrange demos. A demo recommendation neither creates an award/PO nor commits money. In-app assignment, report and COO decision notifications and audit entries are transactional; notification failure rolls the action back. A version conflict preserves browser drafts until deliberate reload.

## Limits and validation

Search is limited to 100 workspaces/items per query; narrow by request number or device. A workspace supports 1–20 evaluators and up to 20 criteria. No automatic assignment of all requests to demos, inventory capitalization of loan units, supplier portal, external messaging, clinical certification, contract handling or automatic cheapest/highest-score procurement is introduced. The existing commercial procurement-evaluation module remains available separately; its prices, lifecycle costs and calculations are not replaced by technical trial scores.

Local PostgreSQL tests apply SQL 050 twice and again with populated history, exercise actual service transactions and the central readiness boundary, multiple companies, approval-stage authority, requesting-department inclusion, tenant isolation, immutable attestation, version conflicts, unfinished-report blocking, COO rejection/resubmission, supplier checks, changed requirements, trial-only return and notification rollback. Frontend tests cover creation, comparison/recommendation, missing reports, evaluator submission, COO decisions and stale drafts.


## Supplier selection and directory recovery

Demo registration selects an existing supplier, using its canonical supplier ID;
there is no separate company record to create. The registration panel reports
supplier loading, empty directory results and load failures beside the selector.
Use **Reload suppliers** after adding/activating a supplier in the Suppliers
directory or repairing its schema. Reload preserves unsaved registration details
and notes. An unavailable/foreign/inactive selected supplier is cleared after a
successful refresh and is independently rejected by the server on registration.

If loading reports missing `public.suppliers.institute_id`, apply the previously
provided complete `sql/manual/052_surgical_consignment_supplier_scope_compatibility.sql`
through Supabase SQL Editor, then reload suppliers. No new SQL patch is introduced
by this UI change. Supplier institute filtering remains required. A free-text
request does not query the governed item catalogue to populate its supplier list;
governed devices still require the selected supplier's approved catalogue device.
