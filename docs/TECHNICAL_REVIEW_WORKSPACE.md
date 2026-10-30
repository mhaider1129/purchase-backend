# Technical Reviews & Inspections

The workspace covers all three redesign stages: a task worklist, controlled
pre-procurement reviews, and quantity-aware Goods Receipt inspections. Technical
opinions do not grant PR, supplier, budget, PO, invoice or payment authorization.

## Deployment and setup

**MANUAL DATABASE MIGRATION REQUIRED** — apply the entire
`purchase-backend/sql/manual/054_technical_review_and_delivery_workflow.sql` in
Supabase SQL Editor. The existing SQL 049 pre-procurement review schema and the
canonical P2P, organizational and inventory schemas must already be installed.
Deploy backend first, then build/deploy frontend.

Open **Management → Technical reviews** (also available through the worklist’s
**Technical responsibilities** link) as an existing SCM/Admin/Procurement
Supervisor with `technical-inspections.manage`. Configure profiles by the
controlled Item Master type; free-text demand uses `unclassified`. Profiles
are initially absent, so no automatic requirement is enabled by the patch.

For each applicable type:

- Choose Level 1 basic verification, Level 2 technical review, or Level 3 formal
  acceptance. Basic verification leaves ordinary receiving in place. Level 2/3
  can require pre-procurement review, delivery inspection, or both. Formal
  acceptance always requires supporting evidence.
- Configure the technical responsibilities: the current requesting-department
  HOD, another department's current HOD, or a designated active departmental
  inspector. Add multiple departments for multidisciplinary assessments.
  Current effective organizational head positions take precedence over a unique
  HOD role fallback. Missing or ambiguous responsibility blocks task generation
  rather than choosing an arbitrary account. Receiving and final sign-off remain
  independent of the technical opinions.
- Select additional pre-procurement checks and delivery checks appropriate to
  the category. Medical devices can include calibration/electrical safety,
  consumables packaging/expiry/sterility, and IT configuration/compatibility.
  Basic delivery specification, condition, documentation and functionality checks
  remain explicit; not-applicable/not-required answers depend on the question.
- Record a change reason. Profile edits use an optimistic version and audit.
  Existing tasks retain their profile and responsibility snapshots.

The profile owner must retain active SCM technical-management authority for
automatic pre-procurement generation. Configure responsibilities before enabling
requirements. A missing current reviewer/owner blocks the final-approval
transaction with setup guidance; it never grants procurement clearance. Generation
runs before final-approved notifications. For already approved PRs, SCM can select
an eligible request and use **Generate configured review**. Reads never create
or mutate tasks.

## Worklist

`/technical-inspections` opens **Technical Reviews & Inspections** without a large
empty inspection form. Pending, In Progress, History and All tasks support search,
assigned department, review type, status and creation-date filters. Four cards
count Awaiting My Review, In Progress, On Hold and Completed using the same
filtered result across every page. Date boundaries use Asia/Baghdad and include
all of the selected end day.

Ordinary users see their active departmental assignments. Existing SCM managers
see the institute's reviews. Authorized receiving officers see delivery tasks
within their institute and can apply authorized receiving dispositions. Historical
forms require their existing management permission and are explicitly distinct
from authenticated task assignments; they never count as Awaiting My Review.

## Pre-procurement technical review

When a controlled-type PR receives final approval, the system generates one
required review with requesting-department and configured specialist assignments.
Generation is idempotent and transactional. It starts as an evidence-preparation
requirement: no inspector can approve an automatically generated placeholder.
SCM prepares the actual proposed supplier/product and sample, data sheet or
written description. A non-sample basis requires a real reason; formal policy
requires evidence. Existing item names, quantities and requirements are read-only.

SCM can also request an additional review on an approved PR. Configured mandatory
reviewers cannot be omitted, and the requesting department must be represented.
The SCM signatory cannot be one of the departmental inspectors. A required
category review binds the actual proposed supplier. Optional requirements-only
reviews remain possible outside mandatory category policy.

The reviewer may start the task, then assess specification compliance,
compatibility, intended-use suitability and any configured additional checks.
The decisions are:

- **Approve** — requires compliant, compatible/not-applicable and suitable
  answers, with no failed additional check.
- **Approve with conditions** — findings are mandatory; procurement remains
  blocked until a new attested round fully approves the resolved conditions.
- **Request clarification** — findings are mandatory and procurement stays blocked.
- **Reject** — findings are mandatory; revise/replace the proposal in a new round.

Every opinion records the authenticated account, timestamp, findings and exact
answers; it does not fabricate responses to the former physical-sample checklist.
The detailed report contract remains readable/usable for existing clients.

SCM's **Revise proposal / resolve conditions or clarification** action records
its reason, retains previous item/evidence/opinion snapshots and resets every
assignment into a new round. The new round requires fresh opinions. Terminal
signed reviews cannot be edited; create a new review for a changed signed proposal.
Final SCM clearance requires every assigned opinion to approve the current
request/item fingerprint. PR approval and normal purchasing authorization remain
separate.

Proposals may bind an approved Product and a normalized RFx quotation line.
Supplier/Product substitution, material Product changes, quotation source changes
or changed quotation content invalidate that clearance. Award creation, PO
creation, PO issue and direct procurement registration recheck the technical gate.
A quotation-bound proposal must use that quotation's canonical award/PO path;
description-only direct registration cannot impersonate the reviewed quotation.
For uncatalogued proposals, the supplier, model/description and selected evidence
are retained; changed proposals must be submitted as a new revision.

## Delivery inspection and receiving

Canonical Goods Receipt creation applies the type's required inspection policy
server-side. Receiving may also explicitly request an additional configured
technical responsibility. Additional profiles combine their reviewers, checks,
evidence requirement and inspection level with mandatory policy; they cannot
replace it with weaker requirements. Transaction data supplies the item, PO,
supplier, specifications, lot/serial and approved-product details.

A required receipt line generates one task in the receipt transaction. Until an
authorized disposition is applied, its net physically received units are held
at receiving, excluded from available inventory, PO accepted fulfillment and
financial acceptance. This is a disposition on the existing receipt, not a
second owned-stock ledger. Existing receipts are not retrospectively reclassified.

Each assigned inspector records explicit policy checks and one decision against
the remaining held quantity:

- **Accept** all remaining units;
- **Partial acceptance**, with exact accepted/rejected quantities and the rest held;
- **Hold / clarification**, retaining all remaining units on hold;
- **Reject** all remaining units for return/replacement/escalation.

Non-full acceptance requires corrective/rejection findings. Not assessed is
available for honest hold/rejection records and cannot release accepted units. Failed checks cannot
release accepted units; segregate affected units and assess the conforming units
explicitly, or hold the delivery. Formal policies require linked evidence. Every
opinion is attested and retained in immutable history. All quantities use the
canonical four-decimal arithmetic and conserve the remaining receipt balance.

An independent SCM signatory authorizes the agreed final disposition only after
all reviewers submit. Disagreement on quantities requires a clarification round,
not an SCM-invented quantity override. An authorized receiving officer then uses
**Apply authorized receiving disposition**. That action calls the canonical Goods
Receipt service, repository and inventory adapter under one transaction. Normal
warehouse/institute/UOM/Stock Item permissions and identity checks remain enforced.
Accepted inventory movements are linked into the existing document flow. Existing
non-available stock status (including a separate quarantine) is retained.

Applying a disposition is idempotent by its immutable authorization identifier.
Accepted/rejected quantities never decrease. Held units can enter another round;
prior signatures and evidence remain intact. Held units reserve PO receiving
capacity, while rejected units free capacity for a replacement. The PO becomes
delivered only when its cumulative accepted quantity reaches the order quantity.
Rejected physical goods remain excluded from stock; document their vendor
return, replacement or escalation in the findings/evidence and normal operational
process. Technical rejection does not fabricate a supplier credit or a return
inventory movement for units that were never posted.

## Finance, assets, completion and evidence

Canonical invoice matching consumes technically accepted receipt quantities.
Match overrides, finance/AP verification/posting and payment recheck cumulative
invoice quantities against technical acceptance, serializing on the PO. An
override cannot authorize held/rejected units or allocate the same accepted units
to multiple invoices. Existing price/value/tax, matching and spend controls remain.

Procurement-sourced assets must link a specifically accepted GR line when
technical acceptance applies. Registration/deployment cannot exceed its accepted
base-unit capacity; an existing asset is excluded from its own capacity count.
Legacy/manual assets without procurement provenance retain their existing path.
Request completion checks also include outstanding required PO-line acceptance,
so completing a historical form cannot clear a delivery hold or rejected remainder.

Technical decisions and revisions use immutable history. Evidence references have
foreign keys preventing deletion of retained attachments, even in a delete/reference
race. File deletion reports a conflict and tells users to upload a revision. New
upload paths contain a UUID to prevent same-name/time overwrites. The patch also
protects existing available attachments selected by old technical reviews; it does
not reconstruct missing historical files, signatures or decisions. Persistent
storage/backups continue to use the application's existing attachment service.

## Compatibility and boundaries

Historical forms open read-only from the worklist; the original editor and
completed-request entry points remain for compatibility. Its old request-status
helper now includes required delivery acceptance. Historical forms are not
quantity-aware GR decisions and cannot update the new receipt acceptance fields.
No historical receipt/task, asset, invoice or inventory backfill is performed.

No new permission grants or dependencies are introduced. The trusted backend
role needs its normal table/sequence/RLS access to the new tables; browser roles
receive no direct access. No production/Supabase SQL was executed by this change.
SQL 054 is tested on populated data and repeat application, with existing
receipt quantities, signed records and new history preserved.

## Older proposal-directory schemas

If the proposal picker reports a missing `institute_id`, apply the complete
`purchase-backend/sql/manual/055_technical_proposal_scope_compatibility.sql`.
SQL 054 does not add these older supplier/catalog scope columns. SQL 055 safely
adds missing scope fields, checks their types, adds foreign keys/indexes, and
preserves existing values and rows. It never guesses an institute for legacy
products or suppliers. NULL retains the original shared catalog/directory
semantics; explicit foreign-institute records remain hidden and cannot be
selected. This applies consistently to the picker and submitted proposals.
Missing columns now produce a named setup error before directory queries run.
