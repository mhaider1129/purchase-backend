# Technical Reviews & Inspections — staged redesign

## Stage 1 delivered

The `/technical-inspections` landing page is a scoped task worklist, with no new
inspection form displayed by default. Its records come from the existing
pre-procurement review service and historical inspection register; it does not
create a second approval engine, receipt ledger or inventory balance.

Pending, In Progress and History tabs support search, assigned department,
review type, status and creation-date filters. Four cards show Awaiting My
Review, In Progress, On Hold and Completed, using the same filtered result as
the table across all pages. Dates use Asia/Baghdad boundaries, inclusive of the
chosen end day. The 25-row page limit does not limit summary counts.

An assigned pre-procurement reviewer sees only their accessible reviews. SCM
management retains its existing role **and** `technical-inspections.manage`
requirements. The worklist is available to authenticated assigned reviewers
without granting them the legacy register's management permission. Opening a
review continues through the existing assigned-opinion and independent SCM
sign-off endpoints, retaining version checks, audit, notifications, evidence
access and procurement gates.

For a routine pre-procurement opinion, the reviewer sees the linked item and
evidence, then three assessments: specification compliance, compatibility and
intended-use suitability. All three require an explicit response. Full approval
requires compliant specifications, compatible/not-applicable compatibility and
suitable intended use. Rejection requires comments/corrective findings. The
server records its assessment time and authenticated signature; client-provided
names or timestamps cannot attest the opinion. It never invents physical
packaging, batch, calibration or other checklist responses from these answers.
Older clients and signed reports retain their original detailed checklist
contract and recorded evidence.

The main worklist opens historical inspections as read-only records. Those
records have no reliable assigned-reviewer identity and are labelled accordingly;
they never contribute to Awaiting My Review. The original editor is retained at
`/technical-inspections/legacy`, including links from completed requests, to
preserve existing functionality. Its register/read/edit/delete and request/item
links are restricted to the actor's institute. Unlinked records are scoped via
their creator's institute; records without either scope are not exposed.

`IN_PROGRESS` in this first stage means that at least one departmental opinion
has been submitted and final sign-off has not occurred. There is no invented
start timestamp. Historical accepted/rejected records and signed/cancelled
pre-procurement reviews appear in History, with their actual decision shown.
The current owners do not yet have a Hold state, so their On Hold count is zero.

## Deployment

No new database migration, permissions, dependencies or lockfile changes are
required for Stage 1. Deploy the backend, then build/deploy the frontend. The
existing SQL `049_preprocurement_technical_reviews.sql` is a prerequisite for
pre-procurement reviews if that module has not already been installed. The
worklist reads schema availability and displays a warning when it is absent;
it does not automatically create or migrate tables. Existing historical CRUD
retains its pre-existing schema initializer.

This implementation does not connect to production/Supabase. Database validation
uses the repository's disposable local PostgreSQL harness.

## Remaining stages and control boundaries

Stage 2 should introduce versioned category/technical-responsibility policies,
capability/position-based reviewer routing, formal-acceptance profiles, proposal
identity/revision binding, condition and clarification cycles and immutable
decision history. Selected-only review remains the existing default; this
change does not enable all-request or category-wide requirements. A conditional
or clarification outcome must not be mapped to APPROVED. Conditions must be
resolved and attested before procurement clearance. Replaced products or revised
quotations need their own current technical evidence.

Stage 3 should generate delivery tasks transactionally from canonical Goods
Receipts, with separate accepted/held/rejected quantities, reviewer opinions and
controlled final receiving disposition. Accepted quantity must feed the existing
receipt, inventory, asset and invoice-matching services; held/rejected quantities
must not become available stock or eligible financial receipts. Partial rejection
also requires a defined replacement/return and cumulative receipt-capacity rule.
No new delivery-inspection task or partial-release control is claimed by Stage 1.
Historical forms must not be presented as quantity-aware GR inspection decisions.

The original editor's request-completion behavior is preserved for compatibility
in Stage 1. The new worklist and concise pre-procurement opinions do not call that
status helper, complete a PR, issue a PO, accept a receipt, release inventory,
register an asset, approve an invoice or authorize payment.
