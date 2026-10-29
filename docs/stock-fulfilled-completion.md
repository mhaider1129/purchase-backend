# Stock fulfillment and completed procurement reporting

Available-in-stock requests count as completed for procurement reporting and leave
active purchasing/approval/priority queues. The explicit **Available in Stock**
label remains; stock fulfillment does not become a fabricated supplier purchase
or warehouse receipt.

The common SQL read model recognizes stock disposition on an item through an
explicit approval/procurement stock status, or the existing warehouse workflow's
combination of a rejected purchase line and a linked warehouse_supply_items row.
An available_quantity value alone is not a fulfillment decision.

For historical requests whose stored status is still Pending/Approved, a request
is stock-resolved only if at least one line has stock disposition and every line
is fulfilled (stock, purchased/completed/received, or full purchased/received
quantity). All-stock requests display Available in Stock; all-resolved mixed
stock/purchased requests display Completed. Mixed stock/pending or partially
purchased requests remain active. Rejected/cancelled and existing terminal
request outcomes are never overwritten by the read model.

This classification is shared by list/status/closed/assigned/history queries,
dashboard completed/backlog/aging totals, approval workload, department reporting,
workspace summaries and priority eligibility. Item responses expose stock
provenance and zero outstanding procurement quantity for stock-resolved lines.
The UI shows a distinct stock label and excludes completed requests from pending
approval scorecards. New procurement events for stock-resolved lines are rejected.

No database migration is required. Existing stored statuses, approval/audit
history, actual purchases, costs, receipt quantities and warehouse fulfillment
records are preserved. Warehouse Supply requests continue their own operational
process; removing the original purchase demand does not assert that goods have
been physically issued or received. Existing per-request/user/institute scopes
and permissions are retained.

After merging, deploy the backend and matching frontend and refresh views.
Historical status projections update on read without a data-repair/backfill SQL.
Original stored status is exposed separately where general request projections
return it. Local PostgreSQL tests exercise stock-only, mixed, partial, rejected,
explicit terminal and available-quantity-only cases with actual dashboard and
request-list queries; all fixture changes roll back.
