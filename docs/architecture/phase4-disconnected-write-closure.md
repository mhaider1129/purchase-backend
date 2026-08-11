# Phase 4 disconnected-write closure

| Direct writer | Classification | Closure |
|---|---|---|
| request create/update and historical import write `unit_cost` | LEGACY/PROJECTION | accepted only as estimate/import history; PO service ignores it as price authority |
| procurement item events update cost, supplier name/status | TO-MIGRATE | event remains history; award and completion services become active writers |
| requested-items controller updates unit cost/status | TO-DISABLE | remove mutation route after consumers use award/projection APIs |
| request update controllers update received quantity | DUPLICATE | receipt service projects aggregate after locked receipt posting |
| P2P controller increments PO received quantity | TO-MIGRATE | locked receipt coordinator + idempotency key owns it |
| P2P controller calculates matches/totals/payments | TO-MIGRATE | totals, invoice match and payment services own facts |
| contract controller posts contract payments and recalculates paid amount | DUPLICATE | retain history; future supplier-invoice settlements use payment service |
| frontend PO/invoice totals | PROJECTION | display-only; persist server response |

Compatibility fields (`supplier_name`, request cost/status/received quantity) are not deleted. Their target is read-only projection populated from master/award/receipt/completion data. Phase 4 services are the only authoritative active writers once SQL 006 is manually deployed and routes are cut over.