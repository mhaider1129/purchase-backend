# Fixed Asset and RFID core

`assets` is the permanent operational identity. Its allocator atomically increments one row per institute; department, room, custodian, and EPC never form part of `asset_number`. Capital and controlled classification is independent of accounting capitalization. Procurement links are optional (including legacy recovery) and preserve PR → item → PO → line → GR → line provenance without duplicating Item Master or Stock Item identity.

Physical `asset_locations` are a separate hierarchy from organization units. Responsible department answers *who owns responsibility*; current location answers *where*. Only receipt in the canonical movement state machine updates current location, transactionally with audit. RFID can corroborate but never authorizes a movement or changes location/custody.

## Custody decision

Existing `custody_records` are administrative issue documents: they can represent a quantity, target a person/department/location, and carry user/HOD approval history. They are not an item-level asset register. Migration 017 adds only a nullable `asset_id` bridge so that existing custody remains the single administrative custody history. No competing asset-custody table is introduced. RFID processing never writes custody.

## RFID boundaries

Tags are replaceable children of assets; active EPC and primary-UHF invariants are database enforced and prior tags remain historical. Readers, antennas, portals and their mappings are vendor-neutral. Integration secrets are generated with 256 bits of entropy and verified with HMAC-SHA-256 using the required `RFID_CREDENTIAL_PEPPER` (at least 32 characters); the pepper is configuration, never a database value. Plaintext is returned only by create/rotate, comparisons are constant-time, and disabled or incorrectly scoped clients fail closed. Normal human JWTs cannot authenticate ingestion, and service credentials never enter the human route stack. A vendor adapter must convert SDK payloads into normalized observations.

Raw reads are immutable technical observations, accepted in batches of up to 500 with explicit-offset timestamps and a 16 KiB raw-payload ceiling, preserved even when an EPC is unknown, and deduplicated only by integration client plus supplied external event ID. They are not individually audited. The retryable processor claims bounded work with `SKIP LOCKED`, commits each logical read independently, and aggregates short-window reads into business events. Ordered SIDE_A/APPROACH to SIDE_B/DEPARTURE evidence produces deterministic entering/exiting direction and confidence; insufficient or unoriented evidence stays `UNKNOWN`. Exactly one compatible approved/in-transit movement makes a portal event authorized, none makes it unauthorized, and multiple matches remain explicitly ambiguous. Unknown and unauthorized logical events each create at most one exception. None of these outcomes performs automatic receipt, location, responsibility, or custody updates.

Portal orientation is deliberately probabilistic evidence rather than physical truth. One enabled antenna may map to at most one enabled portal. SIDE_A/APPROACH is the portal's configured `from_location_id` side and SIDE_B/DEPARTURE is its `to_location_id` side; deployments must validate and tune this convention against their installation.

## Migration governance

Migration 017 remains manual/pending. It preflights canonical dependencies and recognizes only three states: no core objects (install), a complete catalog-compatible state (notice `SQL_017_ALREADY_APPLIED_COMPATIBLE`), or any partial/drifted state (exception `SQL_017_PARTIAL_OR_DRIFTED_SCHEMA`). The allocator uses PostgreSQL's atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING` per institute, so issued values are never recycled. The default prefix is `WICI-A`; changing a stored institute allocator prefix is a governed administrative decision and never rewrites an existing asset number.

Physical inventory sessions, expected snapshots, handheld room reconciliation/proximity locating, vendor SDKs, Android triggers, and hardware-specific direction/radio tuning are intentionally deferred.