# AUD-010: database release governance and Development rollout

Task 7B supersedes the active release with SQL 070 and contract `hospital-erp-2026-11-7b`. SQL 069 is now a frozen governed prerequisite, with its original schema contract preserved. Use [the Task 7B rollout](rfid-crash-recovery-7b.md) for the current release; the 7A architecture and original rollout below remain historical context.


## Finding and current baseline

Reviewed `origin/master` **3aecb532**, including Batches 1–6 and unified completion reporting. Discovery found **068** as the highest existing manual SQL number; this release adds **069**. No hosted database was connected to. Installed database state is therefore **unknown**, not “all migrations applied.”

The confirmed root cause was fragmented schema ownership: manual patches, supplied snapshots, exported runtime CREATE/ALTER arrays, request-time initializers, and startup catalog seeds competed to define the database. Existing read-only SQL 063 checked many names but did not enforce the complete types, definitions, grants and application-release evidence now required. The application previously listened and ran jobs without a complete release compatibility gate. There was no repository-governed checksum journal for the manual SQL files.

`supabase_migrations.schema_migrations` and `public.pgmigrations` are recognized as optional external execution histories. Their presence and available rows are reported read-only. Their usual records do not establish the checksums, actor, environment and application source binding needed here. They are preserved rather than replaced or retroactively imported as APPLIED. An operator must preserve any stronger external evidence separately.

## Inventory and conflicting responsibilities

`database/releases/migration-inventory.json` inventories every SQL artifact under `sql/`, the disposable P2P fixture, literal DDL occurrences in backend runtime/test/tool sources, and the production JavaScript/package source digests. Each SQL record has a classification and checksum. `execution_evidence: UNVERIFIED` means exactly that; classifications do not change history.

| Artifact family | Classification and ownership |
| --- | --- |
| Existing numbered manual SQL 001–068 | Frozen historical; never automatically replayed |
| SQL 007 and verifier/diagnostic SQL | Read-only verification; not a schema application receipt |
| SQL 035, 038–043 | Superseded overlapping structural reconciliation responsibility, consolidated in 059; frozen originals retained |
| SQL 036 / 037 | Superseded permission/UI catalog responsibility, consolidated in 060 / 061 |
| SQL 059 | Reviewed structural reconstruction used by the isolated fixture; not evidence that hosted databases ran 059 |
| SQL 060 / 061 | Missing permission metadata / additive UI defaults; preserve configured policies |
| SQL 064–068 | Contract lifecycle, canonical finance, historical reconciliation, completion, receipt acceptance contracts |
| SQL 069 | Active forward release governance, restricted runtime grants, missing reference metadata |
| Supabase view, permissions and UI SQL snapshots | Context exports; never execute as a migration |
| Other non-numbered SQL / development patches | Frozen legacy or uncertain; inspect individually, never infer a replay order |
| `integration/fixtures/p2p.sql` and isolated integration setup | Test fixture, never a deployment patch |
| Former request-time initialization | Runtime compatibility validation only; SQL now belongs to manual releases |
| Older verification/runners | Diagnostic or disposable test tools, not the release readiness authority |

The machine inventory contains paths and headers for the complete per-file list. Literal SQL scanning intentionally reports dormant reference arrays as well as executable statements; it is not a claim that every string executes. `runtime-remediation.json` preserves the original initializer-body digests and affected tables. `runtime-modules.json` registers all 44 converted initializer entry points, including document branding.

The locked inventory rejects a changed registered SQL/source file and a newly discovered unregistered SQL/source artifact. `db:inventory` prints a proposed inventory; it does not update the lock or declare anything executed. Changes to production sources require a new reviewed source manifest, immutable application release reference and attestation. Do not regenerate locks on a deployment host to suppress drift.

## Authority and evidence model

The new append-only `database_release_migrations` stores identifier, filename, SHA-256, timestamp, environment, status, actor, database session identity, duration, application reference and supporting evidence. APPLIED rows for pre-069 identifiers are rejected. Successful receipts are unique per environment and migration. UPDATE/DELETE fail through immutable-evidence triggers; the runtime has SELECT only, no INSERT/UPDATE/DELETE/TRUNCATE or ledger sequence privilege. Database owners remain trusted and can alter database objects; no SQL journal can prevent a malicious owner rewriting it. Preserve the generated bundle, review record and execution output externally.

`database_release_attestations` binds the current contract version/digest, application source-manifest digest, actual catalog fingerprint, environment and immutable application release reference to an operator review. Its evidence kind explicitly says `CURRENT_SCHEMA_VERIFIED_NOT_HISTORICAL_EXECUTION`. Reusing a release reference with different source content fails.

Only the generated transactional bundle inserts a successful forward receipt after real payload execution and postflight. A failure rolls back both schema changes and success evidence; PostgreSQL cannot persist a FAILED row in the same rolled-back transaction. Capture failure output in the operator’s release record. UNVERIFIED/FAILED statuses are available for explicit evidence administration but never satisfy readiness.

## Read-only contract and runtime permissions

`schema-contract.json` records the reviewed disposable PostgreSQL 16 baseline reconstructed from the supplied exports and maintained canonical SQL. It covers requests/approvals, assignment, RFx, PO, GR, inventory, contracts, AP/payments, planning, procurement completion, receipt acceptance and reporting. It checks relation kinds, RLS flags, column types/defaults/nullability/identity, PK/FK/check/unique definitions and validation, index definitions/readiness, function signatures/results/bodies/security configuration, trigger definitions/enabling, policies, effective browser grants, required capability codes, UI definitions, route policies reference-account metadata and the six existing contract-evaluation criterion codes.

The snapshot is a reviewed expected contract, **not a dump or attestation of hosted data**. Function MD5 values detect definition drift; SHA-256 binds the whole expected and observed catalog. JSON property formatting is not evidence. Required permission codes are definitions, not role/user grants. Existing custom UI and route policies are never overwritten; if they differ from the reviewed release contract, readiness remains blocked until their security impact is reviewed and a versioned compatible contract is committed.

Runtime role checks assess the actual connection principal and effective role. Superuser, role/database creation, schema creation, application ownership or membership in application-owner roles block readiness. Business table DML/SELECT, canonical function EXECUTE and sequence USAGE must exist; writable release evidence blocks readiness. Browser table exposure, extra policies and unknown security-definer routines fail closed. An optional CLI `--backend-role` is clearly a target-role assessment, not proof of the live credential; startup disallows that override.

SQL 069 creates a **NOLOGIN** `purchase_backend` role with bounded repository object grants. The current Express architecture enforces user/institute/capability scope on the trusted server, so this role has BYPASSRLS. It is a trusted server credential, never a browser/supplier credential. Do not give the runtime the migration-owner password or owner memberships. The owner must separately provision the login secret through the organization’s approved secret process. SQL 069 revokes direct anon/authenticated/PUBLIC access to reviewed ERP tables and functions and PUBLIC schema creation. It does not grant user procurement/finance authority, activate V2, or change custom host tables/functions.

`config/db.js` guards both the pool and borrowed clients against DDL, including multi-statement and anonymous-block SQL. Database role restrictions provide the independent authority boundary. Startup pins read-only verification to one transaction/connection before `listen` and worker initialization; missing/incompatible schema, code, evidence or authority blocks startup. Converted `ensure*` functions validate rather than repair schema. Their local table/type checks support independently injected service clients; only the complete startup gate certifies release readiness.

Permission, UI, route-policy and chart-of-accounts initialization no longer seeds on HTTP/startup paths. SQL 069 adds missing canonical permission/route metadata the two existing reference account codes and the six existing evaluation-criterion definitions, without changing configured policies, posting liabilities, payments, inventory, signatures or approval history. Existing configured criterion roles/components are preserved. A legacy criterion with an ambiguous uncoded matching name blocks manual execution for identity review instead of creating a duplicate or rewriting history. Existing explicit authorized administrative policy edits remain available. Stopping/restarting around planned schema/security changes is required; this is a startup gate, not a continuous runtime drift monitor.

## Controlled release planning

Commands run from `purchase-backend`:

```bash
npm run db:inventory
npm run db:plan
npm run db:plan -- --environment development --actor finance-platform-owner --release <immutable-reviewed-release> --output /tmp/review-069.sql
npm run db:verify -- --environment development --release <same-reviewed-release>
```

`db:plan` is offline and never reads a database URL. Review-only SQL output requires explicit actor, environment and release. It validates checksums, rejects frozen files, checks declared ordering, and supports one reviewed transactional forward step at a time. Current 069 has actual baseline-contract prerequisites, including functions from 067/068; those are structural requirements, not claims that particular historical scripts ran. A future release must update the versioned contract, dependency metadata and its preflight deliberately; this tool does not guess a new migration’s prerequisites.

The generated bundle uses one BEGIN/COMMIT, a shared transaction advisory try-lock, 3-second lock timeout, 5-minute statement timeout, baseline preflight, migration payload, exact postflight and atomic receipt/attestation. Repeat execution with the same hash is a verified no-op for receipt rows. A changed hash, invalid order, missing prerequisite, malformed transaction boundary or unsupported concurrent-index operation blocks execution. No destructive down migration exists.

`db:verify` requires a dedicated operator-provided **DB_RELEASE_READONLY_URL**, plus environment/release flags. It never falls back to the application DATABASE_URL and runs REPEATABLE READ READ ONLY. Do not put URLs/passwords in CLI arguments, tickets or logs. A report is DATABASE_READY only when actual schema/security, runtime authority, locked files, successful receipt and current attestation all agree. Schema-only diagnostics are SCHEMA_VERIFIED_UNATTESTED, never ready. Startup additionally requires APP_RELEASE_REF and DB_RELEASE_ENVIRONMENT; missing settings fail closed.

## Manual Development rollout

1. Preserve a restorable backup and an external change-review record. Confirm the actual Development database identity and current master/release. This implementation has not inspected it.
2. Run disposable tests and inspect the locked inventory/contract. Do not copy a Production URL into test variables. Existing bootstrap reconstruction is a **test harness**, not a hosted empty-database installer.
3. Use the read-only verifier with the selected Development credential and save findings. Before 069, missing evidence/governance objects and the old owner runtime credential are expected blockers, not permission to replay historical files.
4. Resolve missing baseline contracts through separately reviewed forward corrections. SQL 069 intentionally does not bootstrap an empty database or silently repair historical business values. Do not blindly run 001–068, exports, or old reconciliation scripts. No clinical/financial/inventory evidence may be guessed or backfilled.
5. Generate `/tmp/review-069.sql` offline from the exact candidate commit/source manifest. Inspect grants/revocations, requirements, actor, environment, release and hashes. The migration source is **`sql/manual/069_database_release_governance.sql`**. Use the **generated reviewed bundle** in Development Supabase SQL Editor, as the migration owner, so postflight and actual execution evidence commit together. Do not paste only 069 and then manually fabricate APPLIED rows.
6. Schedule a maintenance window and stop application/workers before the reviewed owner execution. Save the SQL Editor success/failure output and exact bundle in the external change record. On failure: rollback, inspect the reported difference and prepare a reviewed correction. Never edit frozen scripts or mark a failed execution APPLIED.
7. Provision the dedicated runtime LOGIN credential separately and securely, with no owner membership; configure DATABASE_URL to use it. Keep the migration-owner credential outside the application. Hosted permission to create BYPASSRLS roles must be confirmed by the owner; if unavailable, stop and design an equivalent restricted trusted-server role, never bypass the gate.
8. Configure APP_RELEASE_REF to the reviewed immutable reference and DB_RELEASE_ENVIRONMENT=development. Keep LIVE_ROUTING_ENABLED=false. Run `db:verify` using the **actual runtime connection**, not only a target-role override, and require DATABASE_READY. If the host adds platform-specific objects/policies or uses a different PostgreSQL major, review findings and commit a compatible versioned contract; never regenerate a contract automatically from that host.
9. Only after owner review, manually start the candidate app and check health, request details, procurement, receipts/inspection, stock issue, contracts/AP/payments and completion reports. Promote to other environments only with a separate environment-specific bundle/review. No deploy or hosted SQL was executed here.

## Validation and remaining limitations

See the AUD-010 remediation report for executed commands/results. Disposable integration tests exercise actual preflight/postflight SQL, role privileges, drift, locks, transactional failure, release evidence and preservation of seeded historical rows. Jest mocks old initializer entry points only for existing unit fixtures; the governance PostgreSQL suite uses real catalog queries and actual non-owner credentials.

Readiness is intentionally strict: customized RLS, UI policy, platform objects, types, defaults or function bodies may require reviewed contract variants instead of automatic accommodation. The ledger supplements unverified history and cannot recover missing historical execution evidence. SQL 069 is not a universal bootstrap or historical schema repair. Operator role provisioning, external change-record durability, backup/restore, and hosted compatibility remain manual acceptance responsibilities. Live availability, platform permission provisioning and production readiness have not been verified.
