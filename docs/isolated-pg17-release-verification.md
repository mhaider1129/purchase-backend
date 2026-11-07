# Isolated PostgreSQL 17 release-verification review

## Scope and decision

This is a source review and disposable regression result, not approval to deploy or start a production service. The operator reports an isolated `wici_migration_test` restore on port 55432, successful application of SQL 073, and 2,210 verifier findings. The full finding JSON and current catalog were not attached. No connection was opened to that restore or production Supabase in this task. Neither `wici-recovery` on port 5051 nor Nginx, PM2, deployment scripts or `/var/www/wici-procurement/backend` was modified.

**Decision: actual restore compatibility remains unresolved.** Reducing, relabeling or explaining findings is not release readiness. The new capture remains diagnostic-only and cannot authorize startup.

## Verified root causes

### Contract version

The canonical JSON contract declares `hospital-erp-2026-11-scop1`. The service exported a literal `CONTRACT_VERSION = 'hospital-erp-2026-11-7c'`, but that constant was not used by `loadContract()`, catalog comparison, or the attestation query. Actual verification already loaded the JSON/selected profile and used its `version` and full contract digest. Therefore the stale constant was a metadata defect, not evidence that the verifier was secretly selecting 7C, and not an explanation for all 2,210 findings.

The obsolete literal is replaced by a compatibility-preserving exported getter following the selected contract. An absent/blank contract version is now rejected before certification. Unknown profiles remain rejected. The database contract and profile files are unchanged; the canonical SHA-256 remains `9b3efde7cb01433a91453a1d6b94a187fc1c3b221432b370be18c4464ff9efe6`.

`--release` / `APP_RELEASE_REF` identifies an application artifact. It is not the schema contract version. A matching version label alone never supplies a current source/schema attestation.

### Extension routine mismatch

SQL 059 explicitly executes `CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public`. The reference was captured with vendor implementation functions in `public`; examples are `cash_dist(money,money)` and `gbt_bit_compress(internal)`. Application service/controller/repository code does not call these names directly. The operator reports that the restored extension functions instead reside in `extensions`.

The old function and browser-grant queries select only `public`. A function in another schema is consequently absent from those result sets. Schema relocation also changes `pg_get_functiondef()` output/MD5 and can qualify extension-owned type names. This is a real mismatch with the captured reference assumption; it is not proof the library function is absent from PostgreSQL or that the ERP itself needs a duplicate public wrapper. The legacy per-function contract has no namespace/extension-owner fields, so blindly broadening the query and matching on unqualified names would be unsafe.

New separate evidence queries identify extension membership using `pg_depend` (`deptype='e'`, `pg_extension`), record namespace, extension version, signature, function hash and SECURITY DEFINER status, and distinguish browser EXECUTE from namespace USAGE. They include public/application extension-schema routines and extension-owned routines in non-system schemas. PostgreSQL's `pg_catalog`/`information_schema` implementation handlers are not recast as ERP application routines; installed extension versions are still inventoried.

**The original public snapshot queries, fingerprint representation, expected contract rows and original blocking findings remain intact.** A verified extension counterpart is attached as `extension_environment_review` with `BLOCKING_REVIEW_REQUIRED_NO_AUTOMATIC_EQUIVALENCE`. Candidate matching can explain qualified extension type renderings, but never changes the actual comparison, body hash, grant requirements or fingerprint. Finding count is not used to certify compatibility.

### Browser and application function policy

- A schema name or `gbt_` prefix is never ownership evidence.
- Public application-owned function body/config/signature changes and browser grants retain the existing strict checks. A vendor namesake elsewhere cannot disguise tampering.
- Unreviewed SECURITY DEFINER routines outside public remain blocking, even if extension-owned. Unowned application routines in `extensions` with browser execution also remain blocking, including latent grants without current USAGE.
- Vendor EXECUTE with no namespace USAGE is retained as evidence, not by itself labeled confirmed browser ERP access. Reachable additional vendor browser grants require explicit environment/security review. Existing missing public contract grant rows remain blocking regardless of this distinction.
- This is not a global security certification of Supabase auth/storage or every custom schema. Application public requirements and the extension-scope issue are the reviewed scope.

A future portable extension contract should explicitly state approved extension name/version/schema, dependency provenance, supported PostgreSQL versions and browser access policy separately from application-owned function bodies. This PR does **not** invent that approval or regenerate an expected schema from the restore. Missing public vendor requirements remain unresolved policy findings until that review is complete. Do not move extensions, create public vendor copies, or remove checks merely to fit the reference.

## Categorized remaining findings

Only the reported total (2,210) is available for the current isolated verifier. Exact category counts and object verdicts cannot be inferred from that number. The guarded capture enriches each finding with expected/observed metadata and these categories:

| Category | Interpretation / required evidence |
| --- | --- |
| Application schema/column/routine review | Missing application objects or materially different signatures/types/defaults/guards may be actual incompatibilities. Examine current definitions and canonical writer requirements |
| Constraint or server-representation review | PostgreSQL deparsing, qualified types and stronger validation can differ; CASCADE/SET NULL changes and weaker keys are substantive. No blanket equivalence or normalization is applied |
| Extension environment review | Dependency-proven namespace/version differences, not proof of missing library code or automatic compatibility |
| Application/extension security review | Unreviewed SECURITY DEFINER, browser EXECUTE/USAGE, policy or RLS differences remain blockers |
| Runtime-role provisioning | Isolated restores may lack global roles, membership, BYPASSRLS, sequence/function grants or the bounded backend identity. Compare the actual connection and any separately assessed target role; do not copy production owner authority or elevate a reader to force green |
| Assessment visibility | RLS/SELECT can hide permission/reference/ledger rows. Unknown visibility is not missing data and cannot produce a certifiable fingerprint |
| Release evidence | SQL 073 success alone does not prove governed execution or current attestation. Raw 073 does not insert the generated bundle's receipt/attestation. Restored evidence may legitimately be bound to a different source, profile or observed fingerprint |
| Source attestation | Verifier code edits require their reviewed source checksums. They must not be handled by ignoring source mismatches or resnapshotting database expectations |

The capture records PostgreSQL version, installed extension versions and presence of `anon`, `authenticated`, and `purchase_backend`. A restore's missing global roles or differences in hosted extensions must be separated from genuine application schema failures. No role provisioning or SQL repair is performed by the tool.

## Safe isolated verification procedure

Use a new review checkout away from both backend installations. Do not copy configuration, restart a process, change Nginx/PM2, or run deployment/migration scripts.

```bash
git clone --branch codex/pg17-release-diagnostics https://github.com/mhaider1129/purchase-backend.git "$HOME/wici-verifier-review"
cd "$HOME/wici-verifier-review"
npm ci
```

The capture does not load `.env` or use `DATABASE_URL`/`DB_RELEASE_READONLY_URL`. Supply only an explicit isolated URL through a private environment variable; never put its password in shell history or chat:

```bash
read -r -s -p 'Isolated PostgreSQL URL: ' WICI_ISOLATED_DATABASE_URL
export WICI_ISOLATED_DATABASE_URL
```

Required URL target: numeric loopback `127.0.0.1` (or `::1`), explicit port **55432**, database **wici_migration_test**, explicit credentials and no query/host/options overrides. Other targets are rejected before connection. The client sets a read-only default, starts REPEATABLE READ READ ONLY, then checks actual database identity, PostgreSQL major 17 and transaction read-only state before catalog capture. It cannot assume the runtime role. Target-role assessment is labeled and is not actual runtime acceptance.

Run with the exact application reference and ledger environment being investigated (replace the uppercase placeholder). `production` below describes restored evidence labels, not authorization to connect to Production:

```bash
node scripts/captureIsolatedReleaseDiagnostic.js \
  --profile canonical --environment production \
  --release EXISTING_APPLICATION_REFERENCE \
  --backend-role purchase_backend \
  --output /tmp/wici-pg17-canonical-20261108.json

node scripts/captureIsolatedReleaseDiagnostic.js \
  --profile wici-2026-11 --environment production \
  --release EXISTING_APPLICATION_REFERENCE \
  --backend-role purchase_backend \
  --output /tmp/wici-pg17-wici-profile-20261108.json

unset WICI_ISOLATED_DATABASE_URL
```

The first report explains the selected canonical SCOP1 contract; the second explicitly evaluates the existing reviewed hosted variant, often relevant after 073. Neither is automatically chosen from the observed database. Use distinct output names if files already exist. Outputs must be outside Git, are mode 0600, and contain catalog/reference/role/evidence metadata rather than patient/invoice/payment rows or function bodies. Preserve and redact according to the operator's handling rules before sharing.

Every capture is marked `ISOLATED_READ_ONLY_DIAGNOSTIC_NOT_RESTART_AUTHORIZATION`, BLOCKED and `restart_eligible=false`, independently of its schema finding count. If reference/evidence visibility is incomplete, obtain an authorized complete read-only capture; do not grant writer/BYPASSRLS authority to a reader merely to change the result. The actual new runtime connection still needs independent approval and verification after all schema/security/evidence requirements are resolved.

## Source provenance and SQL safeguards

No schema contract or profile was regenerated. Only the two edited source entries (`catalog.js`, `databaseReleaseService.js`) and their aggregate digest were renewed to reflect the reviewed code, following the established source-attestation workflow. This is not a rebaseline of database findings. The generated operator bundle is rebound offline to `wici-recovery-2026-11-08-r4`.

The complete old/new bundle comparison permits exactly the aggregate-digest substitutions and application-reference substitutions. Legacy snapshot/reference queries are asserted identical. All 104 other SQL artifacts and their hashes remain unchanged, including frozen migrations and SQL 073. The [binding evidence](isolated-pg17-source-binding.json) records exact old/new hashes.

**No migration SQL application is part of this PR.** The R4 bundle is an unexecuted code-binding artifact, not a prescribed fix for the PG17 extension-policy mismatch. Its existing strict pre/postflight remains intact and may reject this restore until the namespace/environment policy is explicitly reviewed. Do not create migration receipts/attestations by hand or rerun 073 to make the count smaller.

## Unresolved blockers and go/no-go

- Obtain the full current 2,210-finding JSON with selected profile, reference, role/membership and installed extension evidence. Per-object classifications and exact counts remain unverified until then.
- Review extension requirements and browser policy before accepting relocation/version differences. No current automatic equivalence exists.
- Resolve genuine application schema, constraint, role and visibility deficiencies through separately reviewed changes.
- Determine which real execution evidence exists and which current source/profile/fingerprint it covers. Preserve unknown history as UNVERIFIED; never fabricate missing receipts.
- Confirm historical finance/inventory/approval/audit preservation and required operational acceptance separately. This task inspected no business rows and cannot certify them.

GO is not established by a successful capture, matching version label or reduced count. It requires an explicitly approved complete compatibility/security contract, actual bounded runtime identity, zero unresolved findings and genuine current source/schema/release evidence, followed by approved operational validation. No production restart/deployment authorization is implied. `LIVE_ROUTING_ENABLED=false`; Approval Engine V2 and optional rollout features remain untouched.

## Executed regression coverage

Unit regressions cover selected/stale/invalid versions, real dependency provenance, qualified extension signature candidates, public application tampering, same-name decoys, vendor/application browser grants, SECURITY DEFINER checks, and refusal of production/wrong-port/wrong-database/override URLs or fallback production credentials. Disposable PostgreSQL 16 and 17 each exercise seven real extension/security scenarios. These fixtures contain no restored hospital data and apply no ERP migration files.

Local Linux results: all 237 backend suites / 2,014 tests passed, with zero skipped tests; all eight focused suites / 70 tests passed. Disposable PostgreSQL 16 and 17 each passed all seven scenarios. Locked source verification returns no findings.

CI runs focused checks on native Windows/Linux, full backend unit tests, and the separate PG16/17 fixtures. CI results and check links are recorded in the PR. A green PR establishes test readiness only; the user's isolated restore and Production remain unverified.
