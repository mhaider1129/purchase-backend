# Authorized R3 source-attestation update

Repository/branch: `purchase-backend`, `recovery/wici-database-20261107`. This completes the explicitly authorized source-lock renewal after portability commit `c23211a3`; it does not execute or attest a database migration.

## Verification before renewal

The only real `verifyFiles()` finding was `CHECKSUM_MISMATCH` for `scripts/lib/databaseRelease/inventory.js`. All other source paths and actual file hashes matched the lock. The reviewed POSIX path fix itself is unchanged by this update.

All 449 application source entries were compared with the current inventory. Only the edited inventory source differed. The locked source SHA was replaced using its actual file bytes, then the aggregate was recomputed using the existing `hash(JSON.stringify(application_sources))` contract and verified against the discovered source inventory.

| Binding | Previous | R3 |
| --- | --- | --- |
| Inventory source SHA-256 | `4a2280fecdf229e5c5174dea1aba5bb375ef07d197a92c934241e99446eb8288` | `454d1f48729674b327c7af3c81fdb4d9b3b9250dc38a2c5c22955c795ea3ff81` |
| Aggregate application manifest | `902f0e5a5581d5f6aa39b3bc319c829a97947756be90ecc5b6603e5ea19c364c` | `be47c2822a3ad320a947f92e313db75613b03595c0fc3a9762cae6b5b802416e` |
| Generated operator bundle SHA-256 | `a35baa9ebc045a7b89cbec9c330119ad45f75114def2fc932a55d33ceeb50b1b` | `a12c41eed5573ab97b2013c69352ce4db57891e59a3c556a36ff0d05fd706cd4` |
| Application release reference | `wici-recovery-2026-11-07-r2` | `wici-recovery-2026-11-07-r3` |

## Generator and exact bundle comparison

Used the existing offline generator:

```bash
DB_RELEASE_SCHEMA_PROFILE=wici-2026-11 node scripts/databaseRelease.js plan \
  --migration 073_wici_observed_schema_recovery \
  --environment production --actor 'WICI authorized operator' \
  --release wici-recovery-2026-11-07-r3 \
  --output sql/operator-recovery/wici-production-recovery.sql
```

The complete R3 string was asserted equal to the previous complete bundle after exactly:

- Two substitutions of the old aggregate source digest with the verified new aggregate.
- Three substitutions of the R2 release reference with R3.

There are no other byte differences. Both bundles contain 4,052,541 bytes. The migration SQL body, SQL 073 receipt checksum, permissions, prerequisites, schema contract, actor/environment, pre/postflight checks and transaction boundaries are unchanged. Updating the generated bundle's artifact SHA was required to keep integrity checks truthful; no migration artifact hash was changed.

## Preservation and governance

All 104 other SQL artifacts were compared byte-for-byte through their original SHA-256 values, and every corresponding artifact record was asserted unchanged. The full path/classification/hash list is in [the machine-readable report](database-release-source-attestation-r3.json).

SQL 073 remains `manual_recovery_migration`, SHA-256 `58122f8c2449dd50d37eaa229d9d622faf7be4e34d56848c999aec5a38285ca2`. The default canonical plan selects only 072; explicitly requesting 073 without the recovery profile still throws `FROZEN_REPLAY_DISABLED`. Frozen replay, tamper detection, source verification, existing receipt-checksum protection and historical UNVERIFIED evidence remain intact.

`highest_manual_number === 73`; actual locked `verifyFiles()` returns **zero findings** after renewal. No fake historical execution receipt or database attestation was inserted. The bundle is future operator-reviewed SQL, not evidence it was run.

## Tests and changed files

Local focused run: **5 suites / 50 tests passed; zero failures, skips or todo tests**. The existing CI matrix runs the identical five suites on native Windows and Ubuntu, with failure exits retained and no in-CI lock regeneration. Detailed per-host results are published as `focused-results-windows-latest` and `focused-results-ubuntu-latest` artifacts for the committed revision; final verified native counts are included in the completion report.

Modified files:

1. `database/releases/migration-inventory.json`: exactly the inventory source SHA, aggregate application digest and regenerated bundle artifact SHA.
2. `sql/operator-recovery/wici-production-recovery.sql`: only the two source-digest and three release-reference bindings above.
3. `tests/wiciRecoveryProfiles.test.js`: R3 reproducibility reference.
4. `docs/database-inventory-path-compatibility.md`: mark the earlier lock blocker as superseded by this authorized update.
5. This report.
6. `docs/database-release-source-attestation-r3.json`: complete digest/comparison/preserved-SQL evidence.

No SQL was executed, no production connection was opened, no credentials/configuration were changed, and no merge or deployment was performed. Any later deployment must explicitly use the approved R3 application reference and matching source/bundle. Existing helper defaults and live runtime settings were deliberately not changed by this offline task.
