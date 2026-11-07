# Database inventory path compatibility

Branch: `recovery/wici-database-20261107` in the standalone `purchase-backend` repository. No changes to the monorepo recovery branch are part of this fix.

## Fix

`scripts/lib/databaseRelease/inventory.js` now converts every `path.relative(root, file)` result to a repository-relative POSIX key before migration-ID extraction, classification, logical sorting or manifest discovery comparisons. The filesystem walker still returns native absolute paths. SQL/source reads continue to use those paths or native `path.join(root, repositoryKey)`; paths and file contents are never conflated.

Reviewed adjacent code: planner/service `path.basename()` receives canonical forward-slash inventory keys, supported by both Windows and POSIX path implementations; profile loading uses native `resolve`/`join`; catalog keys describe database objects rather than filesystem paths. These files require no changes for this defect. Locked manifest strings are not rewritten before their integrity digest is checked. Existing LF `.gitattributes` remains in place.

Regression tests exercise both slash styles through actual discovery, compare complete SQL metadata/hashes against the unchanged lock, check native absolute file reads and runtime-source classification, and ensure a current in-memory planner fixture keeps 073 manual. The fixture is a unit-test input, never a replacement for the locked release manifest. The real frozen-checksum tests remain enabled.

## An unavoidable source-attestation blocker

The unchanged locked manifest includes `scripts/lib/databaseRelease/inventory.js` in `application_sources`. Its recorded SHA-256 is:

`4a2280fecdf229e5c5174dea1aba5bb375ef07d197a92c934241e99446eb8288`

The edited source necessarily has a different SHA-256:

`454d1f48729674b327c7af3c81fdb4d9b3b9250dc38a2c5c22955c795ea3ff81`

The user's instruction forbids changing locked checksum values or regenerating the manifest. This patch follows that instruction. Therefore real `verifyFiles(lockedManifest)` correctly remains fail-closed with exactly one finding:

```json
{"file":"scripts/lib/databaseRelease/inventory.js","reason":"CHECKSUM_MISMATCH"}
```

There are no path-related unregistered-artifact findings after normalization. It is impossible to edit a checksum-bound source file, preserve its recorded old SHA-256 and obtain a truthful zero-finding release verification simultaneously. Ignoring this file, hashing the old Git version, accepting an alternate self-hash or suppressing failing tests would bypass source attestation and is not implemented.

A separately authorized release update would need to approve the new source checksum, recompute the aggregate application-manifest digest, and generate a new source-bound operator bundle/release reference. The proposed aggregate changes from `902f0e5a5581d5f6aa39b3bc319c829a97947756be90ecc5b6603e5ea19c364c` to `be47c2822a3ad320a947f92e313db75613b03595c0fc3a9762cae6b5b802416e`. None of those locked values or SQL files is changed here. Frozen migration contents and all SQL hashes can remain unchanged in that separate review, but the generated operator SQL's source-binding metadata would need renewal. No authorization for that follow-up is assumed.

## Validation

Before the code edit, the five focused suites passed on Linux: 45 tests; the original locked inventory verified with zero findings. After the fix:

- `highest_manual_number` is 73 with either relative-path separator style.
- All SQL artifact IDs, classifications, headers, byte counts, hashes and execution evidence match the existing locked artifact metadata.
- Five new path-regression cases pass. A current in-memory test fixture verifies with zero findings for either slash style and selects only 072 by default. Explicit 073 without its manual profile is rejected; an explicitly selected recovery profile permits the reviewed manual 073 plan.
- The full five-suite run reports 45 passing and 5 failing tests across 3 passing/2 failing suites. The remaining failures are caused by the genuine edited-source checksum mismatch, not Windows path discovery. No failing gate was skipped, downgraded or re-locked.
- `.github/workflows/recovery-path-compatibility.yml` runs the same five suites on native Ubuntu and Windows, retains their failure exit codes and uploads detailed results. Native CI results must be reported separately from local separator simulation.

Focused command:

```bash
npm test -- --runInBand --forceExit databaseReleaseGovernance.test.js wiciRecoveryProfiles.test.js runtimeDatabaseIdentity.test.js prepareRuntimeIdentity.test.js databaseReleaseVisibility.test.js
```

No production connection, migration execution, credential change, merge or deployment is involved. This is not a release-ready branch until the source-attestation blocker is resolved through an explicitly approved release update.
