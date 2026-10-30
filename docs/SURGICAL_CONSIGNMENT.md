# Surgical consignment requests — F18 / F19 / F20

This request type regulates procedure-specific, vendor-owned implant/surgical sets when the exact size is selected during surgery. F18 authorizes arranging consigned stock; F19 records temporary custody; F20 confirms usage, returns and discrepancies. Only clinically confirmed used quantities enter a dedicated normal purchase/PO/invoice handoff. No owned stock, payable or approval of payment is created by the temporary delivery.

## Workflow design

The supplied F18/F19/F20 documents are reference practices, not a mandated digital workflow or a requirement to reproduce paper screens. The workspace is one procedure-specific case: identify the clinical need and size ranges, authorize vendor custody, record delivered lots, confirm actual consumption, reconcile unused stock and exceptions, then hand off used-only billing. Exact sizes need not be selected when requesting. Form identifiers remain on printable supporting records for traceability; operational actions use task names.

Keep clinical authorization, vendor custody, consumption and financial settlement distinct. A delivery is not a purchase, a signed usage record is not payment approval, and custody closure is not payment completion. Existing budget/contract/PO and finance approvals still apply. The current explicit authorization and confirmation roles are the initial controlled route, rather than a claim that the paper form defines every future organizational policy.

## Management setup and the simpler surgeon request

Apply SQL 053, then open **Management → Surgical consignments**. Enable only the
few departments where surgery is performed. For each, set a responsible department
nurse and receiving warehouse. Optional section nurse overrides apply when the
surgeon selects that section. The receiver comes from active warehouse managers/
keepers assigned to the configured warehouse; when there is more than one,
Management selects the responsible account once. Nurses can belong to the Nursing
HR department; the explicit managed responsibility associates them to the surgical
location without moving their account.

For each new request the submitting user is the surgeon. HOD resolves from the
current effective organizational department-head position, falling back only to
a unique active HOD account for that department. CMO and SCM resolve from their
unique active institute roles. Missing/ambiguous/inactive assignments or self
approval block new submission with actionable setup errors; they do not trigger
an arbitrary selection or automatic approval. Management edits affect future
requests. Existing requests retain their recorded team, signatures and commercial
terms. The surgeon may operate in an enabled department other than their HR
account's own department, within the same institute.

The surgeon enters department/optional section, expected date, MRN, procedure,
requested item families and sizes/description, and an optional free-text vendor
recommendation. No supplier-directory selection, commercial reference or six
staff selectors are required. Family/catalogue codes are optional at this stage;
exact supplied sizes, codes and lots remain mandatory at temporary receipt. A
surgeon request provides the initial justification, with optional additional
reasons. The UI shows the assigned team read-only, and the backend recalculates
it at submission; posted staff/authorizer/supplier IDs cannot override routing.

At SCM authorization, SCM chooses the actual eligible supplier and confirms its
contact, currency, agreement/quotation/price-list reference and attached agreement
evidence. The reference identifies the document behind the agreed prices; it is
commercial work for SCM, not an obligation on the surgeon. A recommended vendor
is not automatically approved, created as a supplier or accepted for billing.
Temporary delivery still requires final SCM authorization and documented terms.

## Manual deployment

**MANUAL DATABASE MIGRATION REQUIRED**: apply the **entire** `purchase-backend/sql/manual/051_surgical_consignment.sql`, from `BEGIN;` through `COMMIT;`, in Supabase SQL Editor. Do not run a selected column fragment. The existing repository schema, organization/permission catalog and P2P tables must already be installed. Also apply complete `purchase-backend/sql/manual/053_surgical_consignment_department_routing.sql`
for automatic routing and deferred SCM commercial confirmation. It adds two RLS
configuration tables and nullable case routing/recommendation metadata, and relaxes
only initial supplier/contact/reference nullability. It does not overwrite old
case assignments, suppliers or signatures. No department is automatically enabled.
Deploy the backend before rebuilding/deploying the frontend. No production or Supabase database was accessed during implementation.

The patch adds eleven RLS-protected tables and public privilege revocation. It does not backfill patients, infer signatures, move inventory, reset sequences, or rewrite historical financial values. It conditionally widens only the existing goods-receipt and supplier-invoice fingerprint columns if their declared string capacity is less than the 64 characters required for the existing SHA-256 writers. Existing bytes are preserved; missing historical hash bytes are not reconstructed. Widening uses normal PostgreSQL ALTER locks. The existing invoice writer now records its supplier label from the canonical supplier as well as supplier ID.

Use the application's trusted backend database role. If a custom backend role is used, its normal trusted table/sequence/RLS access must cover the new tables. Browser roles receive no direct clinical-table access or automatic grants.

### Legacy supplier scope compatibility

If the page reports a missing `public.suppliers.institute_id`, apply the entire
`purchase-backend/sql/manual/052_surgical_consignment_supplier_scope_compatibility.sql`
in Supabase SQL Editor. The older supplier-table creator omitted this column,
although the reconciled backend and consignment supplier queries require it.
SQL 051 creates the consignment module; SQL 052 repairs this legacy supplier
prerequisite and is safe to repeat on an already-correct populated supplier table.

SQL 052 adds nullable institute scope only when absent, preserves all existing
supplier fields and ownership, adds the missing FK for future writes without
rewriting legacy orphan values, and reports verification counts. Existing NULL
scope means the shared supplier directory already accepted by the backend; the
patch does not guess which hospital owns a vendor. It changes no clinical,
request, invoice, payment or permission records. The final prerequisite query must
return no missing scope columns. Other missing institute-scope columns require
explicit application schema reconciliation, not an unscoped query fallback.

The schema endpoint, queue reads, form directory and transactional commands
check these prerequisites and return a named 503 schema error before unsafe or
invalid clinical queries. Restart/deploy the backend to obtain the clearer
error; after manual SQL repair reload the page (there is no stale process cache).

### Private document storage

`SURGICAL_CONSIGNMENT_PRIVATE_DIR` optionally sets a dedicated persistent directory for signed clinical forms. The default is `purchase-backend/private-uploads/surgical-consignments`, excluded from Git and outside the public `uploads` directory. A path inside public uploads is refused. The service creates new directories with mode 0700 and random-named files with mode 0600. Configure persistent storage/backups and backend write access before operational use; do not map this directory through Nginx or any static-file server. This first release uses private local/persistent filesystem storage, not the generic request-attachment public path or a supplier portal.

Downloads require a current case assignment or SCM/CMO authority, are scoped to the case/file, and use `Cache-Control: no-store`. Finance-only views contain billing quantities/costs but exclude MRN, procedure text, clinical forms, staff contact snapshots and case journal. General transport audits receive only server-defined module/action metadata; transactional domain audits record references/actions without patient identifiers or free clinical notes. Clinical case views and file downloads are audited separately. The legacy attachment path-download route is also bounded to public uploads so it cannot traverse into this private directory.

## Access and authorization

- Request creation reuses `stock-requests.create` and is limited to enabled surgical departments in the same institute. The submitting account is the surgeon; SCM administrators configure the workflow and commercial approval rather than submitting on behalf of an unspecified doctor.
- Management nursing/warehouse responsibilities and current organization/role assignments determine the team automatically, with distinct surgeon/nurse/receiver and independent HOD/CMO/SCM signatories. No missing-authority auto-approval or emergency bypass is provided. Department setup requires existing `departments.manage` or `permissions.manage`, is versioned and transactionally audited.
- SCM uses its current role plus existing request/procurement/technical-inspection management permission. CMO and explicitly assigned clinical/receiving/approval staff can read clinical case records. Unassigned staff and foreign institutes cannot.
- External vendor representatives are recorded from the signed paper/manifest and evidence upload; their names are not represented as authenticated vendor e-signatures. Hospital attestations use server-recorded account identity/timestamps, not submitted signature fields. Electronic records do not claim handwritten/signature-certificate equivalence.

## Operating steps

1. Open **Requests → Surgical consignment requests**. Complete the short clinical request: enabled surgical department/optional section, expected surgery date, MRN, procedure and requested families/size ranges. Add a free-text vendor recommendation if helpful. Review the automatically assigned team, then submit. Surgeon request justification is recorded; extra justification and known family codes are optional.
2. The department HOD and CMO authorize the clinical need. SCM then chooses an eligible supplier, confirms contact/currency/agreement reference, uploads/selects the agreed commercial document and acknowledges vendor ownership and used-only billing. Final SCM authorization generates the immutable `SCN-institute-case` code. This does not waive separate hospital budget/spend/contract requirements.
3. The assigned hospital receiver records F19, a unique delivery/manifest reference, receiving date/location, recorded vendor representative/contact and signed vendor receipt evidence. Each physical line selects an authorized item family and records the exact size/catalogue code, batch/lot, optional serial, expiry, piece quantity, agreed per-piece rate, packaging/sterility and inspection findings. Capture each size/lot separately. Compromised packaging or expiry before delivery/planned surgery quarantines the lot. SCM separately confirms every temporary receipt before usage can be recorded.
4. After surgery the assigned nurse records the actual procedure event date/outcome and used/damaged/missing quantities for **every** delivered lot, including zeros. Quarantined lots cannot be used. This remains an editable reconciliation draft; it is not yet an invoice authorization. A cancelled/postponed procedure must have zero used quantities and must still reconcile stock already delivered.
5. The receiver records unused returns by exact lot, intact/damaged condition, quantity, date, named receiving vendor representative and signed return evidence. Returned quantities cannot exceed the relevant balance. Compromised packaging cannot be represented as an intact return. Stock cannot disappear by cancelling a case after physical delivery.
6. Damaged/opened unused and missing items are explicit exceptions, not silently added to used billing. F19's potential liability terms remain documented. In this release, a case stays open/disputed until a written vendor **no-charge** resolution is selected and attested by SCM. Unreturned damaged units additionally need vendor-authorized disposal evidence. Record physical damaged returns before final disposal/waiver. A changed usage draft invalidates a waiver for different quantities. **Chargeable loss/damage claims require the institution's separate authorized financial dispute/claim process; this workflow does not fabricate a waiver or automatically approve a chargeable exception.** Do not record a no-charge agreement unless the supporting document actually establishes it.
7. Once all good unused units are returned and every damaged/missing quantity is accounted for, the nurse freezes and attests F20. Surgeon and receiver independently attest the same snapshot, including vendor notification and usage-only billing. Signed usage cannot be overwritten; uploaded evidence is additive. The three role attestations are required before SCM reconciliation.
8. SCM releases the confirmed used-items billing packet. It contains only used quantities, agreed rates and traceable catalogue/lot descriptions, with amounts calculated using the existing decimal-safe money functions. Returned, damaged and missing units do not enter the ordinary consumption bill. Print F18/F19/F20 from the authorized clinical view; finance's print view contains only its restricted billing packet.
9. Use the packet to create the **normal purchase request and obtain standard PO approvals/issue**. No PR/PO is automatically approved by this workspace. Use a dedicated PO containing exactly the used lots, same vendor/currency/rates, one-piece conversion and `NON_INVENTORY` lines because those units have already been consumed. For free-text demand, use the supplied exact descriptions. Governed catalogue PO lines may instead match the exact vendor catalogue code and product/supplier relation. Existing Item Master enforcement still applies to that normal procurement process.
10. SCM loads the company's issued POs and maps every positive used lot to one PO line. Binding refuses surplus/unused PO lines, quantity/rate/UOM/identity mismatches, a different institute/vendor/currency, and POs with prior ordinary receipts/invoices. Binding must occur before the documentary GRN or invoice.
11. Continue through the linked request's standard P2P lifecycle: documentary receipt of the **used pieces and original lot only**, canonical supplier invoice, invoice matching, finance review, payable posting and payment. Bound GRNs cannot post owned inventory or include unused damage/shortage quantities. All submitted non-void/non-cancelled invoices count toward the used-quantity cap, so splitting an invoice cannot double bill. Unit prices/currency must match the agreed usage packet. Normal tax/discount matching, approval and payment controls remain in force.
12. SCM may close the custody-reconciled case after its billing handoff. Finance remains tracked independently in standard P2P; operational closure is not a claim that payment has completed. A completely unused, fully returned/settled consignment may close without a PO. Before delivery, SCM may cancel the authorization; after delivery it must go through reconciliation instead.

## Limits and implementation boundaries

This is a dedicated pre-surgery authorization/custody queue, not ordinary purchase demand for every size loaned. It does not put the loan stock into the owned-stock ledger or create a normal purchase request until the operator performs the used-only handoff. Generic purchase-request dashboards and approval-route editors remain unchanged; the dedicated queue and in-app notifications expose consignment actions. No external emails, supplier login, EMR patient lookup, automatic clinical decisions, retrospective signed-usage corrections, or automatic charging/adjudication of disputed losses are included. If a finalized clinical record is wrong, retain it and escalate under the institution's correction procedure rather than altering a signed statement.

Search by case/authorization/vendor or a delivered catalogue code, lot or serial (confirm actual use in F20; a delivery match alone is not proof of implantation). Search returns up to 100 cases; request families up to 100, receipt lots up to 200 per receipt. Quantities are whole pieces; agreed unit prices support four decimal places, while normal financial totals follow the existing two-decimal P2P convention. Do not use this piece-based flow for reagent volume or fractional-unit consignment without extending the UOM contract. Signed source files depend on the configured persistent private filesystem/backup lifecycle.

## Validation

Local disposable PostgreSQL covers ordered independent authorization, current staff/institute scope, receipt confirmation/quarantine, exact lots and rates, return conservation, waiver snapshot validity, final triple attestation, cancelled/zero-use reconciliation, usage-only dedicated PO mapping, documentary receipt without owned inventory, cumulative supplier-invoice caps, canonical invoice matching, idempotency, notification rollback, repeated populated migration application and preservation when widening narrow fingerprint metadata. The local fixture restores standard SERIAL ownership metadata omitted by the column-only historical export; no production sequence is reset or rewired.

Unit/route tests exercise quantity/rate algebra, quarantines, exception requirements, financial gates, real private file storage/permissions/downloads, denial of finance-only file access, rollback cleanup, public-path traversal bounds and actual transport-audit MRN redaction. React tests cover Management setup, clinical-only submission, automatic routing readiness, SCM-only commercial confirmation, F20 reconciliation/signatures, stale drafts, private uploads and redacted finance views. Known unchanged baseline backend failures are reported in the PR rather than hidden.
