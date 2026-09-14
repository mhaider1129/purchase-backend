# Fixed asset movement semantics

`PENDING_APPROVAL`, `APPROVED`, and `IN_TRANSIT` are active states. An asset can
have only one active movement; drafts may coexist. Transitions lock the asset
row before checking the invariant, while migration 028 adds a partial unique
index as a database backstop.

Receipt is the only movement operation that changes `assets.current_location_id`.
`PERMANENT_TRANSFER` may also apply its optional destination department. All
other types preserve the responsible department.

| Type | Destination and return policy |
| --- | --- |
| `PERMANENT_TRANSFER` | Active governed location required; destination department optional; no simple return. |
| `TEMPORARY_LOAN` | Active governed location and expected return required; canonical return allowed. |
| `MAINTENANCE_TRANSFER` | Active `WORKSHOP` required; canonical return allowed. |
| `EXTERNAL_MAINTENANCE` | Active `EXTERNAL` location and expected return required; canonical return allowed. |
| `STORAGE_TRANSFER` | Active governed location required; no department change. |
| `LOCATION_CORRECTION` | Active corrected location required; no return. |
| `DISPOSAL_TRANSFER` | Physical transfer only; final disposal remains outside this batch. |
| `RETURN` | Created only from an eligible received origin; source is the asset's current location and destination is the origin's source. |

Canonical returns are new draft movements linked through `origin_movement_id`.
They follow the normal submit, approve, dispatch, and receive workflow. The
origin remains `RECEIVED`; the unsafe `RECEIVED` to `RETURNED` transition and
route are intentionally unavailable.