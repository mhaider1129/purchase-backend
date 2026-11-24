# Task 7C / AUD-014: transactional audit and notification reliability

## Baseline and confirmed faults

Reviewed master `d6fc982f` with Tasks 7A and 7B. SQL 070 was the highest existing migration. The canonical P2P, inventory, assignment, contract and RFID services already own their business transactions and authoritative audits. The after-response `governance_audit_trail` middleware is HTTP telemetry: it cannot roll back a committed business action and is not its authoritative financial audit.

Confirmed gaps were legacy approval email inside open business transactions, request-creation approval notices emitted only after commit, assignment email sent inside the in-app outbox delivery transaction, and daily reminders recorded as sent without confirmed transport acceptance. External handoff had no separate durable acknowledgment/lease. Exhausted legacy processing states could remain stranded, errors exposed internal text, and recipient authority was not uniformly rechecked. These are independent of the RFID lease fixed in 7B.

## Event producer inventory and audit authority matrix

“Required event” includes internal durable projection events; it does not imply an email for every HTTP write. Existing approval, award, stock, financial and workload policies remain authoritative.

| Operation / canonical owner | Required authoritative evidence in business transaction | Required event / recipients | Optional notification or telemetry |
| --- | --- | --- | --- |
| PR creation / `createRequestController` | `REQUEST_CREATED`; requester, institute, request, initial status and ownership | Active approval member notices; same-institute internal users; current approval rechecked before delivery | Duplicate-request warning uses an isolated savepoint; failure does not invalidate creation |
| PR decision / `approvalsController`, `approvalContinuationService` | Existing `approval_logs` and `request_logs`, plus `APPROVAL_DECIDED`, level activation and final approval evidence | Existing requester/next approver/SCM workflow notices and email intentions, transactionally queued | HTTP attempt log is supplementary |
| Scheduled activation and reminders / `controllers/utils` | Activation or approval-reminder audit with server job identity (null actor), source institute and operation key | Current active approval member; requester receipt follow-up remains informational | Reminders do not establish receipt, acceptance or fulfillment |
| Assignment / `procurementAssignmentService` | `PROCUREMENT_ASSIGNMENT_CHANGED`, before/after assignments, method, actor, reason and durable log ID | Existing `PROCUREMENT_ASSIGNMENT_CHANGED` outbox; currently eligible assigned buyer | No workload, eligibility or assignment algorithm change |
| RFx award / `rfxPortalController`, `procurementAwardService` | RFx operation audit and `AWARD_CREATED`, award/request/item/supplier provenance | Existing award and generated-PO projection events; no new supplier email | Reports retain existing authorized calculation audit |
| PO issuance / `purchaseOrderService` | `PO_ISSUED`, approved PO, actor, institute and budget evidence | Existing PO event in same transaction; recipient-less internal projection | No new approval route or financial notice invented |
| GR / `goodsReceiptService` | `GOODS_RECEIPT_POSTED`, receipt quantities and source links; inventory movement audit where applicable | Existing GR/PO projection events; required delivery-review task notices | Header existence never establishes technical acceptance |
| Technical review/acceptance / `preprocurementTechnicalReviewService`, `deliveryInspectionService`, `technicalReviewProfiles` | Signed technical history and central technical/delivery audits; controlled acceptance event | Existing reviewer/coordinator notices through source-linked outbox, keyed by review/task version | Independent reviewers, signed evidence, AUD-008/009 gates unchanged |
| Inventory / `inventoryPostingService`, receipt status transfer | `inventory.movement.posted`, source document, actor, institute, warehouse, quantity and allocation evidence | Receipt acceptance/release projection event where that canonical workflow already publishes one | Standalone movement does not invent a human notification |
| Contract lifecycle / `contractAuthorizationService`, contract controller | Contract logs plus transactional `CONTRACT_*` with server-derived scope and before/after snapshots | No existing mandatory human-delivery event; none invented | Library/HTTP telemetry remains distinct |
| Supplier invoice / `supplierInvoiceService`, `financeVerificationService` | Submission/match and `FINANCE_VERIFIED` audits in canonical transaction | Existing invoice/verification projection outbox | External supplier identities never become internal user IDs |
| AP posting / `apPostingService` | `AP_VOUCHER_POSTED`, posting/payable and before/after liability evidence | Existing AP outbox in same posting transaction | No GL activation or second liability path |
| Payment / `paymentService` | `PAYMENT_PARTIAL` / `PAYMENT_COMPLETED`, allocations and balance evidence | Existing canonical payment outbox | No bank settlement or legacy paid-value rewrite |
| RFID interpretation / `rfidEventProcessor`, `rfidJobService` | 7B attempt history and `RFID_READ_PROCESSED` commit with observation/outcome | No production notification producer exists here; preserved | 7B atomic-read recovery and inventory isolation unchanged |

Critical audit writers and outbox producers require the actual business transaction client with an assigned transaction ID. Canonical services obtain it through their mutation/locking boundary. Required insert failures propagate and roll back. Legacy decisions refresh the approval after acquiring the request lock, preventing concurrent stale decisions. Existing conditional transitions and command keys prevent duplicate mutations; new audit operation keys serialize retries and reject actor/institute identity conflicts. Audit details retain source IDs, before/after state and correlation metadata without adding an alternative audit table.

## Delivery model and guarantees

The existing `notification_outbox` remains the event owner. New supported business events carry database-derived institute, payload version 1, canonical source, intended internal user, stable operation key and creation time. Old rows remain version 0/unscoped until actual authorized processing can derive their source; no historical values are silently backfilled. Conflicting reuse of an outbox identity fails rather than overwriting payloads.

In-app delivery uses one short transaction with `FOR UPDATE SKIP LOCKED`, a savepoint, unique `notifications.outbox_event_id`, internal projection writes and acknowledgment. Disconnect before commit rolls everything back. A row lock protects an active worker; an old committed PROCESSING row, including a missing processing timestamp, is reclaimable after 15 minutes. Failure uses bounded exponential backoff (15 seconds to one hour), eight failures and visible `dead_letter`; revoked recipients become `suppressed`. No raw error text is exposed by the operational API.

External email has a separate durable `notification_email_deliveries` row, unique per event/user. Claim and increment attempt count in a short committed transaction, with a UUID token and two-minute lease. Prepare only committed payloads; recheck current user, source, institute, document authority and active approval, then renew/fence the lease before handoff. A 30-second heartbeat supports slow transport. No database transaction spans SMTP. Acknowledge in another token-fenced transaction. Crashes, expired/null leases and lost database connections remain recoverable; the eighth attempt becomes terminal. Suppression, permanent rejection, temporary transport failure and unavailable/dry-run transport have separate categories. Empty/unconfirmed transport results never acknowledge delivery.

The existing application startup gate and outbox scheduler now drain both channels. PostgreSQL locks and leases coordinate multiple application instances; a process-local timer is not the authority. Abrupt shutdown can interrupt an email handoff; the durable lease permits recovery. Required emails are intentions queued with the business action, not a claim that SMTP accepted them before commit.

Delivery is **durable at-least-once attempt**, subject to a healthy worker/database and retry budget. Stable Message-ID and an idempotency option are forwarded to transport. SMTP provides no general downstream deduplication guarantee. If external acceptance occurs but acknowledgment is lost, retry can send twice. The fault test intentionally demonstrates this; no exactly-once external-delivery claim is made. A downstream provider supporting genuine idempotency would be needed to strengthen that guarantee.

## Recipient authority and reads

`eventAuthority` follows actual canonical source relationships, never a frontend institute selector. Only internal `users` IDs are accepted. Cross-institute envelopes/recipients fail before commit. Delivery and email preparation recheck active persisted users and fresh permissions. Assignment uses existing buyer eligibility and current ownership; PR notices use canonical request read authority; technical notices reuse the actual technical-review/task authorization service, including current departmental responsibility. Approval action links are generated at delivery, not persisted signed tokens.

Notification reads recheck current institute and request/technical/RFID access, including already-delivered linked notices. Malformed historical source metadata fails closed without invalid casts. Unknown old unlinked personal notices retain compatibility; their provenance cannot be certified retroactively. Revocation after the final committed authorization check but before external SMTP acceptance cannot atomically retract an external handoff. Payloads should therefore remain minimal and document URLs remain independently authorized.

## Read-only diagnostics and operations

`GET /api/notifications/operations` requires explicit `operations.events.view` plus fresh active persisted user authority. The migration defines the permission but grants it to no role/user. Existing permission administration can assign it to approved operators. The endpoint always uses the actor's institute, disregards forged claim scope, and runs a repeatable-read, read-only transaction.

It reports audit/outbox gaps for canonical award, issued PO, GR, verified invoice, posted AP and paid-payment records, assignment log identities, missing approval history and technical/inventory/contract/RFID audit evidence. Financial sources include canonical contract-only relationships. It returns the real installation cutover, scoped queue/status summaries, latest delivery/lease/retry timestamps, failure categories, dead letters and duplicate source/recipient candidates. Findings and detail lists are bounded to 100 per category; summaries count the full institute queue. Duplicate candidates can be legitimate distinct transitions and never mean confirmed duplicate settlement or external delivery.

Absent evidence is explicitly `REVIEW_REQUIRED_NO_HISTORICAL_INFERENCE`: current headers cannot prove every historical transition or reconstruct an intended old recipient. Review original source/history and external evidence; never fabricate audit rows, fabricate successful delivery acknowledgments, reset exhausted attempts or replay a financial command to repair a notification. Historical events with no defensible institute are excluded from scoped ordinary-user diagnostics and require a separately authorized owner investigation.

Monitor queue age, failed counts, dead letters, lease expiry and worker/process logs. The API supplies operational data; it is not an external paging integration. Dead-letter replay is deliberately not a new public mutation endpoint. Investigate cause and use a separately reviewed operational correction, preserving original identity and retry evidence.

## Manual Development rollout

**MANUAL DATABASE MIGRATION REQUIRED:** `purchase-backend/sql/manual/071_transactional_event_reliability.sql`.

1. Preserve backup, an external review/execution record and actual Development database identity. No hosted state was inspected or modified here.
2. Confirm genuine same-environment governed 069 and 070 receipts, including frozen checksums. If missing, use the respective reviewed release at its original revision and its documented manual process. Do not fabricate receipts or replay frozen migrations with the new planner. The original 070 expected contract is preserved under `database/releases/prerequisites/070-schema-contract.json`.
3. Stop application/workers during the migration window. From the exact reviewed candidate source in `purchase-backend`, generate an offline bundle:

   ```sh
   npm run db:plan -- --environment development --actor <operator> --release <immutable-candidate-ref> --output /tmp/review-071.sql
   ```

4. Review that generated bundle, then the owner manually executes it in Development SQL Editor. It checks the prior/current compatible contract, actual prerequisite receipts, timeouts/shared lock and all postconditions, and atomically records actual 071 execution plus the new source/schema attestation. Running the bare payload alone does not satisfy release readiness.
5. Keep the restricted backend credential. Manually bind `APP_RELEASE_REF` to the reviewed immutable candidate and the correct `DB_RELEASE_ENVIRONMENT`. Run `db:verify -- --connection-mode runtime` with an operator-supplied read-only URL and the actual runtime principal; require `DATABASE_READY`. Do not use the migration-owner credential for the app. `LIVE_ROUTING_ENABLED=false`; do not activate Approval Engine V2.
6. Assign the new read-only diagnostics capability through existing authorized administration. Confirm same-institute approval/assignment/receipt/payment acceptance, denied foreign access, queue age, SMTP configuration, suppression and dead letters in Development. No real-recipient email or hosted/PM2/SMTP acceptance was exercised by disposable tests.
7. Owner separately approves any later deployment. This PR does not merge, deploy, run hosted SQL, rewrite historical audits, create liabilities/payments, or alter approval/stock/financial policies. Stop the app if readiness fails; do not roll back by dropping queue/history tables. Use a reviewed forward correction if needed.

SQL 071 adds nullable outbox institute/version/category fields, explicit terminal states, durable email delivery/lease metadata, an immutable installation cutover and permission metadata. It preserves existing records and canonical notification uniqueness. New tables use RLS with browser/PUBLIC/service-role grants revoked and restricted backend DML/sequence use. Frozen SQL 001–070 is unchanged. The reviewed target contract has 262 relations, 3,552 columns, 1,517 constraints, 696 indexes, 217 functions and 26 triggers; this is expected disposable structure, not proof of a hosted installation.

## Validation

See the linked [audit remediation record](../../docs/audits/2026-11-aud014-remediation.md) for executed commands, results, coverage and exact files. Test helpers explicitly assume a business transaction only in existing mock-based unit fixtures. Real PostgreSQL tests do not mock the transaction guard, authorization, audit insertion or outbox persistence. SMTP is injected only at the external transport boundary; no real recipient is contacted.
