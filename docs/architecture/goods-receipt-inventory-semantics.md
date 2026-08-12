# Goods receipt inventory semantics

A persisted receipt line's `received_quantity` is the gross physical delivery reported at the dock. `damaged_quantity` and `short_quantity` are explicit deductions. The established accepted quantity is:

`accepted = received - damaged - short`

All values must be non-negative, accepted cannot be negative, and gross receipt cannot exceed the PO line's remaining quantity according to cumulative receipt history. Accepted quantity drives the repairable PO-line received projection, PO completion, and inventory movement quantity. This preserves the former controller/adapter rule while eliminating its duplicate calculations.

Only a PO line whose persisted `line_type` is `INVENTORY` creates inventory. It must resolve to a canonical stock item and warehouse/institute scope. Batch, lot, serial, expiry, source/base UOM and stock status flow from receipt row to the Phase 3 allocation command. A `QUARANTINE` receipt increases quarantined physical stock and increases available stock by zero. Non-inventory and service lines record acceptance without stock. Asset/medical-device handoff is preserved as receipt-only pending its dedicated downstream workflow.

Receipt reversal is not deletion and is deferred to Phase 4B.1; a posted movement must be reversed through the canonical inventory reversal facility.