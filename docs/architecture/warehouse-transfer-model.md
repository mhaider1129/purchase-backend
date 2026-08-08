# Warehouse transfer model

## Current state
`warehouseTransfersController.approveTransfer` performs an immediate source decrement and destination increment in one approval transaction and inserts paired warehouse movements. There is no in-transit inventory and no destination acceptance. This contradicts a physical dispatch/receipt lifecycle, so the flow remains legacy for Phase 3 rather than being superficially adapted.

## Target state
`Requested -> Approved -> Dispatched -> In Transit -> Received` (or cancelled/rejected before dispatch). `TRANSFER_DISPATCH` decreases only the source. `TRANSFER_RECEIPT` increases only the destination after acceptance. Both share transfer/correlation IDs, have distinct idempotency keys, and may be partially dispatched/received. A reversal compensates the applicable leg; it never edits/deletes history. Phase 3B must add lifecycle transition validation, outstanding in-transit quantity, destination acceptance, and atomic per-event posting before removing the legacy writer.