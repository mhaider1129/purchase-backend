# Development schema and financial control baseline

## Decision and current readiness

This is task 1 of the [P2P audit's implementation sequence](p2p-architecture-audit.md).
The owner confirmed development project **`bcvfosxcyvarieiinovo`** and three
financial policy decisions on 2026-10-05. These supersede the earlier MCP project
example `ytzvnbwrgvkkixtgnjcg`. Production remains outside this task's scope.

The development database contains legacy requests, stock and contract payments,
but no active connected P2P/AP transaction chain or governed item master data was
visible in the read-only API capture. Several accounting fields exposed by the
database differ from the current writer. This environment is **not ready to certify
an end-to-end purchase**.

The baseline is partial: HTTPS schema/count inspection succeeded; PostgreSQL TCP
returned `ECONNREFUSED`. The new diagnostic tool is validated against isolated
PostgreSQL, but its full catalog/reconciliation capture has not run against
development. Exact numeric scales, RLS, trigger/constraint definitions, grants and
migration history therefore remain unverified. Do not resolve those unknowns by
automatically applying the repository's combined patch or initializing masters.

Repository baseline: merged audit PR #8, `origin/master` commit
`ce092db8ecb46aea2360e363bb85e3c7034a5c08`.
All shared-database operations in this task were GET/HEAD reads. No shared SQL,
migration, data repair, master seed, application startup or financial mutation
was performed. Test fixture writes were confined to the runner-created disposable
PostgreSQL database.

## Confirmed owner policies

| Decision | Owner's choice | Implementation implication |
| --- | --- | --- |
| PO and payment actor separation | Require a different approver | The creator/preparer's person ID cannot approve their own PO or payment. Role membership alone is insufficient. Effective approval and immutable actor/source evidence are required before issue/settlement. |
| Accounting owner | This ERP's general ledger | Build internal source-controlled journal posting and reconciliation. No external accounting handoff is selected. |
| Delivery/inspection acceptance | Require acceptance before AP posting | Applicable inspected goods and service delivery/milestones need approved acceptance evidence before liability posting. An invoice match or voucher's existence alone is not acceptance. |

These choices are recorded, **not yet enforced by application changes**. No
administrator/self-approval exception was selected. Do not silently add one.
Distinct PO/payment approvers do not automatically define who may verify a voucher,
amount thresholds or delegation expiry; those remain decisions below.

## Read-only development evidence

The supplied `SUPABASE_URL`, `DATABASE_URL` and service-role key were reused after
project identity was confirmed. Credentials were not printed or committed.
Supabase OpenAPI returned HTTP 200 and exposed 230 entity definitions. The repeatable
HTTPS tool measured counts for 53 targeted entities; `pgmigrations` was not exposed.
Absence from PostgREST is not proof that a relation does not exist in PostgreSQL.

The counts below describe development data visible to the supplied service role
on 2026-10-05. They are independent API reads, not one transaction snapshot, and
they do not establish application-user permissions or RLS behavior.

| Group | Visible rows | Consequence for acceptance testing |
| --- | --- | --- |
| Requests / requested items / approvals | 68 / 72 / 277 | Existing tracker data must be preserved and classified; it is not proof of the connected lifecycle. |
| Suppliers | 4 | Reuse canonical IDs; eligibility still needs actual validation. |
| Generic Items / Approved Products / Supplier Catalog / item UOM | 0 / 0 / 0 / 0 | A governed purchase cannot start with these masters absent. Plan reviewed identity/UOM mapping and controlled development fixtures; do not auto-map descriptions. |
| Stock Items / warehouse stock levels | 100 / 3 | Legacy inventory exists despite absent governed masters. Retain balances and source identities. |
| RFx events / responses / normalized response items / awards | 0 / 0 / 0 / 0 | No supplier-selection/award handoff is proven by existing data. |
| Purchase orders / lines | 2 / 2 | Both headers are `PO_ISSUED`; both lack at least one request/supplier ID. They are legacy-link reconciliation candidates. |
| Receipts / receipt lines / inventory transactions / allocations | 0 / 0 / 0 / 0 | Receipt-driven stock/provenance has not been demonstrated here. |
| Supplier invoices / invoice lines / matches / override decisions | 0 / 0 / 0 / 0 | Matching and duplicate-bill behavior remain untested against deployed financial records. |
| AP vouchers / voucher lines / postings / payables | 0 / 0 / 0 / 0 | No liability recognition chain is demonstrated. |
| Procurement payment records / allocations | 0 / 0 | No procurement settlement exists in the capture. |
| Budget envelopes / commitment ledger | 0 / 0 | PO issue/AP actualization needs an owner-approved development budget setup. Do not create arbitrary limits. |
| Contracts / items / invoices / payments / consumption | 5 / 0 / 0 / 5 / 0 | Contract payment records exist outside the AP/invoice chain. |
| Journals / journal lines / GL postings / GL lines | 0 / 0 / 0 / 0 | No GL recognition/settlement reconciliation can be certified. |
| Approval policies / versions / route snapshots | 1 / 2 / 0 | Presence does not prove an active policy or that the UI uses its engine. |
| Organization units / positions | 67 / 4 | Effective position authority and institute scope still require review. |
| Document flow / domain audit / notification outbox | 1 / 92 / 0 | The flow edge is `DIRECT_PURCHASE_PO` → `PURCHASE_ORDER`; mixed historical document types need preservation. |

### Financial and identity exception candidates

Minimal selected fields were read for all five contracts, five contract payments,
100 Stock Items, two POs and one document-flow edge. Exact API counts matched the
number of rows inspected for those reads. Record IDs, supplier bill numbers,
names and raw row payloads are not included in this report or committed outputs.

| Observation | Candidate meaning / next decision |
| --- | --- |
| Three contract payments are `paid` and have no invoice ID; two are `pending` | The three may be valid advances or legacy settlements. Require evidence/classification and a reconciled opening balance; do not fabricate invoices or silently reverse them. |
| One contract payment has a currency different from its contract | Confirm authorized FX/advance terms and currency-specific balance treatment. No exchange rate or currency conversion is inferred. |
| All 100 Stock Items lack at least one Generic/Product/inventory-UOM ID | Inventory is not ready for deterministic governed receipt resolution. An intentionally fungible Generic still needs an explicit policy; absence of Product alone does not prove a corrupt item. |
| Both issued POs lack at least one request/supplier ID | Reconcile actual source and supplier evidence; a header label `PO_ISSUED` must not bypass canonical links. |

No procurement/contract duplicate bill could be established from empty invoice
tables. Empty AP/payment tables also cannot prove matching/overpayment controls
are correct. The native tool contains 20 candidate checks covering duplicate
supplier identities, cross-source bills, invoice/PO links, repeated invoice lines,
posted AP authority, duplicate active liabilities, allocation/balance/currency
consistency, contract advances/overpayment/projections, stock ambiguity, UOM,
maker/approver equality and duplicate journal sources. Those shared-development
SQL checks remain **unrun**, not passing zero-count results.

### Exposed schema versus source writer

| Entity | Observed OpenAPI contract | Current source expectation / implication |
| --- | --- | --- |
| `requested_items` | `quantity` has integer format; no exposed `approved_quantity`; `stocking_policy` exists | Award currently falls back to requested quantity. Verify how partial item approval is represented before enforcing an approved-demand quantity gate. The disposable fixture's four-decimal quantity/approved column is not evidence of deployed compatibility. |
| `procurement_awards` | Quantity/price numeric; no exposed `line_type` | Confirms that the exposed award contract does not propagate inventory classification. |
| PO/GRN lines | UOM snapshot fields and numeric quantities exposed | Exact NUMERIC precision/scale is not in OpenAPI; do not assume four decimals or that receipt conversion constraints exist. |
| `ap_payables` | Supplier/invoice/voucher IDs exposed with reported FK metadata | Supports the intended linked domain; does not verify constraint validity, uniqueness or shape required by migration 031. |
| `journal_entries` | `journal_number`, `entry_status`, `created_by`; no exposed `journal_type`, `journal_reference`, `currency`, `total_amount`, `posted_by` | `financeCoreService.createJournalEntry` inserts the missing fields. Turning on its call without compatibility work would not establish a working GL. |
| `journal_entry_lines` | `line_number`; no exposed `line_no` or `cost_center_id` | The current writer inserts `line_no` and `cost_center_id`. Resolve the canonical schema/readers before a forward change. |
| `gl_postings` | No exposed `journal_entry_id` | The accrual helper writes this field. Its accounting link requires deployed catalog verification and a reviewed design. |
| Contract invoice/payment entities | Separate supplier/invoice links, mutable status and amount fields exposed | Existing financial records must be reconciled before common AP/settlement cutover. |

OpenAPI can be stale or restricted. These are observed API/source discrepancies,
not a claim that a specific migration is missing or that CREATE IF NOT EXISTS
will repair the database. The internal-GL design must also preserve legitimate
existing journal readers and field naming.

The compared [journal writer](../../services/financeCoreService.js#L142),
[accrual helper](../../services/financeCoreService.js#L255) and reusable
[request authorization service](../../services/requestAuthorizationService.js#L21)
are the current source boundaries; the disposable fixture is not their deployed
schema authority.

## Control matrix for subsequent implementation

**Confirmed** rows incorporate the owner's answers. **Proposed** rules follow
existing architecture/integrity requirements and need review; **Open** choices
must be resolved before dependent accounting or settlement behavior is implemented.

| Boundary | Required behavior / decision | State and reusable implementation |
| --- | --- | --- |
| Institute/resource access | Apply actor institute IDs and object relationships on reads and writes; distinguish document containment from actor authority | Proposed: reuse `requestAuthorizationService.getInstituteScope/findAuthorizedRequest`; existing `requests.view-all` remains institute-scoped. Central SCM gets explicit institute scope, not implicit global role bypass. Contract textual institute mapping needs review. |
| Demand release | Award/PO effects require an approved request and nonrejected, current approved line demand | Proposed: decide partial approval quantity authority from actual schema/evidence. Internal warehouse fulfillment is a separate valid branch. |
| PO approval | Different creator and approver; effective authority before issue | Confirmed separation. Open: amount tiers, approver positions, delegation and policy snapshot. Keep locked budget commitment/eligibility validation. |
| Service/quality acceptance | Approved applicable service/milestone/inspection acceptance before AP posting | Confirmed gate. Open: governed category applicability, partial/quarantine/dispute evidence. Reuse inspection records where appropriate. |
| Invoice identity and matching | Canonical supplier/PO line/source links; one normalized supplier bill registry across procurement/contracts; exact cumulative per-line caps | Proposed: immutable posted evidence and governed corrections. Retention/credit/replacement identity must be distinguishable from a second payable for the same bill. |
| Voucher/finance verification | Balanced authoritative values, mapped eligible accounts, effective match/acceptance and verification authority | Existing exact-cent accounting validation remains. Open: voucher maker/checker policy and effective authority; PO/payment separation does not by itself settle this choice. |
| Payment approval | Different preparer and approver; no client-assigned paid state as authority | Confirmed separation. Current payment command immediately records settlement: it needs explicit prepared/approved authority evidence, stable payload identity and separation from execution before the new rule can be enforced. |
| Settlement execution | Posted liability, exact currency/remaining balance, immutable allocation, audit/outbox and replay safety | Proposed: preserve current locked AP allocation engine. Open: bank/reference evidence, execution role and reconciliation/reversal policy. No bank integration or transfer is performed here. |
| Contract advances | Explicit approved advance/milestone/retention source; common financial authority | Open: classify the three paid invoice-free records and pending payments before mapping opening balances; never use a dummy PO to make AP accept them. |
| Precision | Different quantity versus money precision; reject unrepresentable values before persistence | Existing journal/voucher money precision is two decimals. Open: IQD/USD treatment, tax/discount rounding and exact deployed column types. Do not infer monetary policy from PostgreSQL rounding. |
| Accounting | ERP-owned GL with source-unique recognition/settlement and balanced lines | Confirmed owner. Open: chart of accounts, inventory/asset/expense/GRNI timing, taxes, FX, periods, opening balances, reversals and reconciliation. Hard-coded sample accounts cannot become policy. |
| Operational/financial close | Retain capacity for accepted unposted obligations; derive independent completion flags | Proposed: decide late-bill/final commitment-release policy; repair line/UOM completion and expose it to live API/UI. |
| Audit and migration | Domain effects/audit/outbox commit together; forward manual migrations only after evidence/review | Existing canonical writers provide the pattern. No runtime DDL or automatic legacy backfill belongs in this baseline. |

## Repeatable capture and exit status

From `purchase-backend`, use the already injected development bindings. Do not
paste credentials into chat/commands or use production bindings. The guard checks
both Supabase HTTPS project identity and PostgreSQL direct/pooler identity before
any connection. It rejects URL overrides, unrelated hosts and other projects.

```sh
# Complete catalog and visible-row candidate counts, when native PostgreSQL works:
npm run audit:p2p-baseline -- --output /tmp/p2p-development-baseline.json

# Partial HTTPS metadata and exact visible-row counts through the cloud proxy:
npm run audit:p2p-baseline -- --https --output /tmp/p2p-development-rest-baseline.json
```

Native capture uses a dedicated `pg.Client`, verified TLS, read-only default,
statement/lock timeouts and one `REPEATABLE READ READ ONLY` transaction. It asserts
read-only state and always rolls back. SELECTs inspect columns/types, constraints,
indexes, triggers, policies, visible grants/current-role privileges and known
migration-ledger metadata. Missing fields or failed candidate scans are recorded
as unavailable; a savepoint prevents one unavailable data check aborting later
checks. It imports no application connection/bootstrap/ensure code.

HTTPS mode needs Python 3's standard library and uses the environment's HTTPS
proxy, verified TLS and GET/HEAD only. It rejects redirects to protect credentials.
It deliberately does not emulate catalog/RLS or financial join checks. Both modes
save evidence to a new private `0600` file and refuse overwriting an existing file.
Keep diagnostic JSON outside the repository; do not commit it.

- Exit **0**: native target-table/count/check capture completed. This is not an
  application/security certification; review connecting-role visibility and ledger limits.
- Exit **2**: partial capture saved, including HTTPS mode or unavailable native checks.
- Exit **1**: target/config/connection/capture failure; no completed report saved.

The existing `verify:p2p-schema` gate remains unchanged. It checks a narrower
deployment contract; neither tool applies migration 031 or any other patch.

## MCP setup and remaining external prerequisite

Codex `.codex/config.toml` and Claude `.mcp.json` now target the confirmed project
with `read_only=true`. The official Supabase skills are already installed.
Configuration is not authentication: no authenticated Supabase MCP tools are
loaded into the current cloud session. See [client setup instructions](../../../.codex/README.md).

The requested `codex mcp add` was attempted and failed to persist configuration
under `/run/codex-environment/codex-home` because that mount is read-only. Login
with an inline URL override reached the interactive browser/callback flow but
was stopped without completing OAuth. `codex mcp list` with that override reports
enabled and authentication **Unknown**, not authenticated. `/mcp` is an interactive
Codex command, not a shell command. The Claude CLI is not installed here.

Complete the project-scoped read-only OAuth login in a regular interactive client
with writable Codex configuration, then reload its tools, or provide working
native development PostgreSQL access through environment settings. Never replace
this with production credentials. The supplied native pooler returned connection
refused; changing SQL, repeatedly retrying or disabling TLS cannot establish access.
The pending catalog can then be captured without changing any schema/data.

## Verification and next work

Executed for this task:

- `npm test -- --runInBand`: **171 suites / 1,230 tests passed**.
- `npm test -- --runInBand --runTestsByPath tests/p2pBaseline.test.js`: **16 tests passed**,
  covering wrong-project rejection, connection overrides, read-only enforcement,
  rollback, unavailable schema/timeouts, CLI privacy and partial HTTPS semantics.
- `npm run test:p2p-postgres`: **17 tests passed** in the isolated pinned PostgreSQL
  container. The new scenario executes all 20 financial candidate queries, checks
  real catalog types/constraints, detects deliberately seeded bad links/balances/
  duplicates and verifies the scan did not change financial/inventory evidence.
- HTTPS metadata/count capture: successful; **53 measured targeted entities**,
  one unexposed ledger, explicit partial exit status. Minimal-field development
  exception reads covered all selected rows by exact API count.
- Native shared-development capture: **blocked, ECONNREFUSED**, not passing.

The cloud environment's reusable `start_skill` draft was updated to document
these tested baseline commands, the confirmed project, private output/partial
exit semantics, current MCP/native limitations and existing frontend workflow.
The install script and credential bindings were preserved. A saved configuration
draft does not authenticate MCP, execute setup or publish a new environment.

No frontend changes or application build/startup were needed. No shared financial
effect or migration was tested by executing it against development. This change
needs no database migration or application deployment.

Next, finish the read-only catalog/constraint/RLS comparison using authenticated
tools or native access. Confirm partial approved demand, institute mappings and
effective approval authority. Then implement task 2 (resource scopes and approved
demand/PO actor separation) using existing authorization services, followed by
precision/immutability and contract containment. Bank execution, account mappings,
budget amounts, master mapping and historical settlement interpretation remain
explicit review decisions, not invented defaults.
