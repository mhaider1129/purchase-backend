# Pre-procurement technical reviews — DPP.SC.001.F07

This workflow records departmental technical opinions before buying an approved request. It is separate from the existing acceptance inspections after delivery, which remain available unchanged. A technical decision never changes request approval, receipt, purchased quantity, completion or payment state.

## Deployment

**MANUAL DATABASE MIGRATION REQUIRED**: apply `purchase-backend/sql/manual/049_preprocurement_technical_reviews.sql` in the Supabase SQL Editor before deploying the backend and rebuilt frontend. The patch creates three new tables with RLS enabled and restricted public access; it does not change historical inspections, infer signatures or backfill approvals. Reapplying it preserves existing review rows. It assumes the repository's existing institute, department, request, user, notification and audit schema is already installed.

Use the application's existing trusted backend database connection. If deployment uses a custom database role, the owner must explicitly grant that role access to the three new tables and their sequences and provide its normal trusted RLS access. No access is granted to browser roles. Do not expose backend credentials to the frontend.

SCM, Admin or ProcurementSupervisor accounts need the existing `technical-inspections.manage` permission and a configured institute. The patch grants no roles or permissions. Reviewers require an active account in a department in the same institute; their explicit assignment permits access without granting SCM management authority.

After merging, deploy the backend, rebuild/deploy the frontend, and check Technical Inspections → Pre-procurement departmental reviews. Account → My technical reviews also opens the assigned inbox. No production database connection or migration was executed during implementation.

## Send and review

1. SCM opens **Send a request for technical review**, selects an approved or partially procured request and the outstanding items. Fulfilled, stock-available and rejected lines are excluded; Warehouse Supply is outside this procurement workflow.
2. Record the item category, supplier/manufacturer/model/batch details and the evidence description. Choose:
   - Physical sample: record the sample's received date.
   - Data sheet: upload/select a request attachment and explain why no sample is available.
   - Technical description: record enough specifications for a meaningful opinion and explain why no sample is available.
3. Assign named inspectors from the requesting department and any other relevant departments. At least one inspector must belong to the requesting department. Every selected inspector is required. SCM cannot assign themselves and later sign off their own opinion.
4. Enter instructions and send. Assignments, in-app notifications and the audit event are committed together. There is no external email or messaging delivery.
5. Inspectors use their inbox/notification to assess every selected item using the source form's condition/comments/action checklist, inspection date/time, overall condition, findings, recommendations and technical decision. Unsupported checks can be marked Not assessed; non-applicable checks can be marked Not applicable. Compliance with specifications must be assessed and met before approval. Explicit critical specification, functionality, expiry, sterility, safety or compatibility failures cannot be approved.
6. Once every inspector approves, an independent SCM/procurement supervisor records a reason and signs technical clearance. SCM may reject or cancel a review but cannot override a rejected departmental opinion into approval. Submitted opinions and finalized rounds cannot be edited; send a new round when revisions are needed.
7. Print the review record for the item evidence, individual checklists, opinions and supervisor signature. These are authenticated account attestations with server-recorded identity and timestamps, not handwritten signatures or a reproduction of the original Word file.

## Procurement requirement

The default is **SCM-selected reviews**. Never-routed requests retain existing procurement behavior. Once a request has a review history, every item to be procured needs clearance; include all intended items or send later outstanding items in a new round. The latest round covering an item determines that item's clearance. Cancelling or rejecting a round does not restore an older approval for that item or release the request from review requirements.

The expandable **Technical review requirement** setting lets SCM require clearance for every approved request in their institute, with an audited change reason. Enabling it also affects existing approved demand on its next procurement command; historical procurement documents are preserved. Disabling it removes the requirement only for never-routed requests.

The central identity/readiness boundary blocks award creation, PO creation and procurement registration while a required technical review is pending, rejected, cancelled or stale. Sourcing and supplier quotations remain possible so SCM can obtain sample/data-sheet evidence. Identity, quantity, request approval, supplier and financial controls still apply independently. A review does not authorize payment or waive those controls.

Material item changes (name, requested quantity, specifications, brand, requested unit or controlled item/product identity) or a changed requesting department invalidate an earlier clearance. Procurement progress alone does not. Restart review after material changes. Stale browser submissions return a conflict and preserve the typed report until the user deliberately reloads.

Before SQL 049 is installed, the new review APIs return a migration-required response; procurement keeps its existing behavior because no review/policy can yet exist. With the schema installed, capability/query failures do not authorize procurement.

## Validation and limits

Local PostgreSQL coverage applies the patch twice, exercises actual service transactions and the central procurement gate, validates same-institute/assigned-reviewer authority, requesting-department inclusion, segregation of duties, rejected/cancelled rounds, idempotency, stale snapshots, signed opinions, policy changes and notification rollback. No production database was used.

The inbox and eligible-request search return up to 100 rows; narrow by request number or description. A round supports up to 100 items and 20 inspectors. Attachments use the existing request attachment storage/download lifecycle; retain the source documents alongside the signed record. This release does not introduce handwritten signatures, signature certificates, reviewer delegation, reminders, or SLA escalation. Existing acceptance inspections remain the receiving workflow.
