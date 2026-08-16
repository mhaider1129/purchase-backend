# Non-Stock item governance

Non-Stock means **not routinely stocked**; it does not mean that a canonical Item Master record must exist before requisition submission. Request approval and item-identity resolution are separate decisions so stewardship effort is not required for demand which may be rejected.

A requester may select a known Generic Item/Product or submit `request_mode=free_text`. Free text is stored as `catalog_status=pending_mapping`, and the requester's `item_name` and `item_name_snapshot` remain unchanged. Approval does not promote or silently match that text.

After approval, a user with `item-master.map` may explicitly resolve the line to an active Generic Item, an approved Product, or an existing Stock Item through the request identity-resolution endpoint. Each decision requires a reason and writes an item-master audit event with actor, time, source, and target. A Stock Item mapping reuses that record and does not create inventory identity. Warehouse availability should be reviewed to decide fulfillment versus replenishment; this service does not cancel demand automatically.

If there is no suitable Generic Item, the same authorized user can link the line to the existing `pending_item_requests` workflow. Its eventual resolution updates the original requested item. No second new-item workflow is introduced.

Unresolved ordinary physical lines are blocked from RFx with `ITEM_IDENTITY_RESOLUTION_REQUIRED`. A Generic resolution is sufficient to source: the exact approved Product and Supplier Catalog Item are supplied by the successful offer and are mandatory at physical award/PO conversion. `approved_free_text_exception` remains available only with `item-master.free-text-exception` permission and a business reason. Services and approved exceptions bypass the ordinary physical identity gate. Inventory conversion factors are never inferred from free text or defaulted to one.