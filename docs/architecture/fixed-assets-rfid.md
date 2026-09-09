# Fixed Asset and RFID core

`assets` is the permanent operational identity. Its allocator atomically increments one row per institute; department, room, custodian, and EPC never form part of `asset_number`. Capital and controlled classification is independent of accounting capitalization. Procurement links are optional (including legacy recovery) and preserve PR → item → PO → line → GR → line provenance without duplicating Item Master or Stock Item identity.

Physical `asset_locations` are a separate hierarchy from organization units. Responsible department answers *who owns responsibility*; current location answers *where*. Only receipt in the canonical movement state machine updates current location, transactionally with audit. RFID can corroborate but never authorizes a movement or changes location/custody.

## Custody decision

Existing `custody_records` are administrative issue documents: they can represent a quantity, target a person/department/location, and carry user/HOD approval history. They are not an item-level asset register. Migration 017 adds only a nullable `asset_id` bridge so that existing custody remains the single administrative custody history. No competing asset-custody table is introduced. RFID processing never writes custody.

## RFID boundaries

Tags are replaceable children of assets; active EPC and primary-UHF invariants are database enforced and prior tags remain historical. Readers, antennas, portals and their mappings are vendor-neutral. Secrets are SHA-256 digests in isolated integration-client records, accepted only by the RFID authentication middleware. Normal human JWTs cannot authenticate ingestion, and service credentials never enter the human route stack. A vendor adapter must convert SDK payloads into normalized observations.

Raw reads are immutable technical observations, accepted in batches of up to 500, preserved even when an EPC is unknown, and deduplicated only by integration client plus supplied external event ID. They are not individually audited. The retryable processor locks pending rows and aggregates short-window reads into business events; unknown EPCs create one deduplicated exception per business event. Direction defaults to `UNKNOWN`: future portal configuration can provide evidence and confidence. Approved/in-transit movement matching is the extension point for authorized movement events, but automatic receipt/location updates remain disabled.

Physical inventory sessions, expected snapshots, handheld room reconciliation/proximity locating, vendor SDKs, Android triggers, and hardware-specific direction/radio tuning are intentionally deferred.