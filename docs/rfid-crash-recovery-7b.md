# Task 7B / AUD-012 — RFID crash recovery

## Reviewed architecture and reproduced failure

Baseline: master **68c36468**, including Task 7A (PR 98). Highest installed-in-repository SQL discovered: **069**; this task adds **070**. Installed hosted schema/history remains unknown. No hosted or Production connection, SQL execution, deployment or merge occurred.

| Path | Existing ownership / execution model | Change |
| --- | --- | --- |
| `POST /api/rfid/read-events[/batch]` | Service-authenticated, synchronous atomic ingestion of up to 500 raw observations; returns 202 and durable PENDING rows | Preserve the atomic batch, recheck source authority in its transaction, add stable identities for new uploads |
| `POST /api/rfid/process` | Human-authorized synchronous request invokes the processor; previously selected globally | Preserve bounded manual processing; scope to the authenticated institute and revalidate current operator authority |
| RFID interpretation | Asynchronous, per-read business-event aggregation and exception creation | Durable lease, fenced execution, per-read checkpoint, bounded retry, attempt/audit history |
| Worker startup/scheduling | No automatic RFID startup/poller was wired; only the manual trigger was found | Post-7A startup-gate worker, immediate first pass, 5-second polling, up to 50 reads per pass |
| Tag/asset assignment and replacement | Synchronous canonical tag/asset services | Unchanged; the processor never assigns a tag, relocates an asset or changes custody |
| Physical inventory / reconciliation | Synchronous authorized session, observation, review and resolution services | Unchanged; RFID processing is not count application or reconciliation approval |
| Notifications | Separate canonical outbox; RFID interpretation generated no notifications | Unchanged; recovery does not introduce notifications or external delivery |

The pre-change processor committed a PROCESSING claim for an entire selected batch and only subsequently opened transactions for individual reads. Future selection included PENDING/FAILED only. A crash after claim, restart, disconnect or process termination could therefore strand PROCESSING rows permanently. Manual invocation also lacked an institute predicate. Failures retried immediately without durable backoff and stored raw exception messages.

Disposable tests reproduce the committed-claim gap, rollback on connection termination, lost acknowledgement after commit, simultaneous workers, expiry and final-attempt crashes. A new worker instance recovers from persisted database state; no in-memory ownership marker is needed.

## Durable model and partial progress

Reuse `rfid_read_events` as the queue. Do not introduce another inventory or asset job subsystem. Claim one read **just before processing**, rather than leasing a long tail of an uploaded batch. A claim transaction uses `FOR UPDATE SKIP LOCKED`, increments the existing attempt count, writes a unique UUID lease token and worker identity, and inserts `rfid_processing_attempts` plus a claim/recovery audit event together.

The lease is 60 seconds, measured by PostgreSQL time. Heartbeat timestamps are written at claim, transaction start and successful completion. Business processing is a short database-only transaction: no vendor calls, network delivery or slow external work runs within it. It takes the read row lock, verifies the exact token/worker/current lease and current authority, then atomically commits aggregation, exception creation, completion audit, processed state and the attempt outcome. All queue transactions, including claim, failure bookkeeping and operator recovery, use 3/10/15-second lock/statement/idle-transaction timeouts. Transaction row locking prevents an expired lease being stolen while a live processing transaction holds that row; an expired-looking dashboard timestamp alone is not authority to override the lock. The design does not need a separate heartbeat process for long external work.

This is **checkpointed batch processing with an atomic transaction per read**, compatible with the existing 500-observation upload limit and interpretation algorithm. Completed reads remain PROCESSED and cannot be reapplied. Uncommitted changes roll back on crash; only that read retries after its lease expires. A process that loses the COMMIT acknowledgement cannot overwrite a later success: failure recording and completion are fenced against the exact current token/worker/status.

States:

- PENDING: durable queued input.
- PROCESSING: committed claim with lease ownership.
- FAILED: transient failure, not due until `processing_next_attempt_at`.
- PROCESSED / IGNORED: preserve their established outcomes; never automatically replay them.
- DEAD_LETTER: exhausted budget or invalid authority/identity/evidence needing investigation.

Preserve the existing maximum of **five attempts**. Transient retry delays are 5, 10, 20, 40 seconds, capped at 300 seconds for the backoff function; there is no infinite reset. A crash on the fifth attempt becomes a terminal visible state after expiry. Legacy PROCESSING rows without a lease can be recovered as technical queued work; no historical lease/heartbeat/source identity is invented. Reads with a prior business-event link or processed timestamp but an inconsistent job state are contained for investigation instead of replaying uncertain evidence.

A failed database connection may prevent even failure bookkeeping. In that case the claim remains durable and expires; do not guess whether COMMIT succeeded. `rfid_processing_attempts` retains each actual new attempt and its outcome. Finalized rows and deletion are protected by a trigger; runtime grants exclude TRUNCATE/sequence reset. No historical attempt records are manufactured for older processing counts.

## Idempotency and identity

For uploads with `externalEventId`, preserve the established integration-client/external-ID identity. Two different external IDs remain distinct even if their other measurements are identical. Reuse of the same ID with contradictory normalized observation data returns 409 (`RFID_EVENT_IDENTITY_CONFLICT`) instead of silently dropping it.

For uploads without an external ID, compute a deterministic SHA-256 source fingerprint from reader, antenna, portal, EPC, TID, normalized timestamp, source type and RSSI. The index is scoped to the authenticated integration client. Raw transport payload/field ordering does not become an operation key. This catches exact resubmissions while preserving distinct timestamps, antennas, readers or measurements. Identical measurement tuples cannot distinguish separate physical reads when a device provides no event ID; gateways should supply stable external IDs. Existing JavaScript timestamp precision is milliseconds.

Only new rows receive a fingerprint. Historical raw observations, EPCs, source payloads, source identities and business outcomes are not backfilled or rewritten. Legacy explicit-ID duplicates can be compared using their existing source fields without updating them.

Read completion, the read-to-business-event link and audit commit together. The token/status checks and atomic checkpoint prevent replaying observation-count increments. Existing EPC/portal advisory aggregation locking and unique business-event/exception identity remain in use. Distinct useful reads can aggregate into one bounded-window event; their count increases once per committed read. No asset assignment, stock movement, count application or reconciliation decision is inferred from an EPC.

## Authorization and scope

| Operation | Required server authority |
| --- | --- |
| Upload | Current enabled integration client with `rfid:ingest`, same-institute active reader/antenna/portal/location and valid asset/tag relationship |
| Manual processing | Existing `rfid.manage-infrastructure`, current active user and authenticated institute; rechecked at claim and execution |
| Queue view / attempt history | Existing `rfid.manage-infrastructure`, current active same-institute user |
| Explicit recovery | Same authority, current valid original source context, recoverable state, remaining retry budget and a 3–500 character reason |
| Scheduled recovery | Trusted backend worker revalidates the original integration-client authority and object scope for every read; cannot perform warehouse/asset approval mutations |

No role names/user IDs are embedded in production authorization. Actor permissions use the canonical permission service, including its existing effective grant semantics. Institute identity never comes from upload/query/body institute IDs. Client, reader, tag, asset, portal and physical location relationships are checked and locked in the processing transaction; credential revocation, disabled infrastructure or changed ownership fails closed. Original integration identity remains attached to the read, while attempt records/audit identify the triggering operator or system worker.

There is **no warehouse-job or stock identity relationship** in this RFID processor. Physical `asset_locations` are not inventory warehouses. Explicit top-level warehouse, count-session, asset or institute authority selectors in uploads are rejected rather than converted into an invented stock operation. Raw payload may retain vendor evidence but never grants authority. Existing warehouse supply/count services remain their only canonical mutation owners.

Manual recovery is idempotent for an already-PENDING read, never resets attempts, never steals a live lease and does not replay PROCESSED/IGNORED/DEAD_LETTER outcomes. Terminal jobs require explicit investigation/governed reconciliation; no automatic historical reprocessing or exhausted-budget reset is provided.

## Operational visibility and shutdown

Authorized APIs:

- `GET /api/rfid/jobs?status=FAILED&limit=25&page=1`
- `GET /api/rfid/jobs/:id/attempts`
- `POST /api/rfid/jobs/:id/recover` with `{ "reason": "Reviewed transient database interruption" }`
- Existing `POST /api/rfid/process` remains an optional bounded manual trigger.

The RFID event monitor shows a processing queue panel only to infrastructure managers. It exposes job status, attempts, last heartbeat, lease expiry, retry due time, recovery count/state and sanitized error category, with reason-required recovery actions. The panel displays the latest 25 matching reads; the API supports pagination. No lease tokens, worker identity, credentials or raw stack traces are exposed. The existing raw-read API also stops selecting the internal processing-error column.

The worker starts only after Task 7A verification, and recovers stale jobs on startup and later polls. Its timer is only a scheduler, not a lock. Multiple instances are safe through PostgreSQL claiming and fencing. SIGTERM/SIGINT stop new claims and wait for the current per-read transaction; abrupt termination is recovered through the persisted lease. Database/application outage time still delays recovery until a healthy, authorized worker runs. The implementation is not a hardware-health or external alert-delivery system.

## Manual Development rollout and migration governance

**MANUAL DATABASE MIGRATION REQUIRED:** `sql/manual/070_rfid_processing_recovery.sql`.

1. Preserve backup and an external review/execution record; confirm the actual Development identity. No hosted state was inspected here.
2. Review Task 7A first. SQL 069 must have a genuine APPLIED receipt for the same environment, filename and frozen checksum. If missing, use the reviewed 7A release/bundle from its own commit and verify it. Do not mark 069 applied by hand, import unverified legacy claims or replay frozen scripts automatically.
3. Stop application/workers in a maintenance window. Do not modify SQL 001–069. The saved prerequisite contract under `database/releases/prerequisites/069-schema-contract.json` is the reviewed 7A expectation, not a hosted snapshot.
4. From the exact candidate source/locked manifest, run offline:

   ```bash
   npm run db:plan -- --environment development --actor <operator> --release <immutable-7b-release-ref> --output /tmp/review-070.sql
   ```

5. Review the generated bundle and manually execute it in Development SQL Editor as migration owner. It validates the actual reviewed 7A baseline (or an already-compatible target), the genuine 069 receipt, timeouts/lock and full postconditions, then records actual 070 execution and the separate 7B attestation atomically. An unreceipted already-compatible target is still genuinely executed; compatible schema alone never becomes proof that a historical script ran.
6. Retain the restricted backend credential provisioned by 7A. Update APP_RELEASE_REF to the reviewed 7B release and retain DB_RELEASE_ENVIRONMENT. Run `db:verify` with the dedicated operator-supplied read-only URL using the actual runtime credential; require DATABASE_READY. The runtime gate requires both governed 069 and 070 receipts and the current source/schema attestation. Do not use the owner password as the backend credential.
7. Only after owner approval, manually start the application, inspect the processing queue and exercise same-institute ingestion/recovery. Disabled clients, stale identity and terminal outcomes require investigation. Physical-reader/gateway acceptance remains an operator responsibility. LIVE_ROUTING_ENABLED stays false; Approval Engine V2 is unchanged.

SQL 070 adds only technical processing fields, indexes, attempt evidence and its guard. It does not automatically requeue historical rows during migration, rewrite raw observations, post stock, assign assets or invent reconciliation outcomes. Actual stale-job recovery occurs only when the authorized worker/manual operation runs. No deployment or merge is performed by these instructions or scripts.

Task 7A's offline planner now treats 069 as a frozen governed prerequisite and selects only active SQL 070. It checks the saved prerequisite contract's source digest, registered dependency order, successful prerequisite receipt/checksum and the new complete target contract. This is a forward release, not a second migration runner.

## Validation and limits

See `docs/audits/2026-11-aud012-remediation.md` for executed commands/results and exact changed files. Disposable tests cover commit/crash boundaries, source identity, leases, retries, scope, audit/notification idempotency, protected attempt history, restricted-role execution and preservation of populated stock/asset/count records. Test-only fixture code genuinely executes 069 on runner-created loopback PostgreSQL to establish a prerequisite; it is never reachable from runtime or the release CLI.

No physical RFID device, vendor gateway, hosted grants, production PM2 lifecycle or live deployment has been tested. Devices without stable IDs retain the stated measurement-identity ambiguity. The short atomic-read model must be revisited before adding external I/O or large batch work inside a lease. Existing physical inventory/stock/asset approval policies remain authoritative. Terminal evidence conflicts and pre-existing inconsistent history require explicit review rather than automatic repair.
