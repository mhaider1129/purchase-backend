# Phase 4 real checked-in schema map

This map is based on `ensureProcureToPayTables.js`, `ensureFinanceCoreTables.js`, the 2026-03-12/13 SQL, and `View_Supabase_SQL.sql`; no live database was queried.

| Concept | Existing authority and useful columns | PK/FK type / finding |
|---|---|---|
| Request | `requests`: `id`, `status`, `department_id`, `project_id`, `estimated_cost` | `id INTEGER`; authoritative request table. `purchase_requests` does not exist. |
| Requested Item | `requested_items`: `id`, `request_id`, `quantity`, `approval_status`, `supplier_name`, `unit_cost`, `procurement_status`, `received_quantity`, item-master IDs | `id/request_id INTEGER`; mutable supplier/cost fields are legacy projections. |
| Supplier | `suppliers`: `id`, `name`, `status`, `supplier_category`, `currency`, `credit_limit` | `id INTEGER`; no checked-in blacklist, qualification, suspension-until, or category-membership relation. |
| Quotation/RFx | `rfx_events` and `rfx_responses`: request, supplier, bid, response JSON, status | Both `id INTEGER`; item-level price structure is not governed relationally. |
| Purchase Order | `purchase_orders`: `id`, `request_id`, `supplier_id`, `po_number`, `status`, `total_amount` | `id BIGINT`, request/supplier `INTEGER`. |
| PO Item | `purchase_order_items`: `id`, `purchase_order_id`, `requested_item_id`, `quantity`, `unit_price`, `received_quantity`, `invoiced_quantity` | `id/PO FK BIGINT`; requested item FK `INTEGER`. SQL 006 adds award/provenance. |
| Goods Receipt | `goods_receipts`: `id`, `request_id`, `purchase_order_id`, `receipt_number`, receipt metadata | `id/PO FK BIGINT`; request `INTEGER`. |
| Receipt Item | `goods_receipt_items`: `goods_receipt_id`, `requested_item_id`, `item_name`, `ordered_quantity`, `received_quantity`, `damaged_quantity`, `short_quantity`, `unit_price`, `line_notes`; SQL 006 adds `purchase_order_item_id` | `id/receipt/PO-item BIGINT`; requested item `INTEGER`. Production SQL never uses the nonexistent `goods_receipt_lines` or `accepted_quantity`. |
| Supplier Invoice | `supplier_invoices`: `id`, `request_id`, `supplier` (snapshot), `supplier_id`, `purchase_order_id`, identity/date/totals/currency | Canonical PO column is `purchase_order_id`; IDs BIGINT except request/supplier INTEGER. |
| Invoice Item | `invoice_items`: `supplier_invoice_id`, `requested_item_id`, `description`, `quantity`, `unit_price`, `line_total`; SQL 006 adds `purchase_order_item_id` | Invoice/PO-item FKs BIGINT. Production SQL never uses the nonexistent `supplier_invoice_items`. |
| Match Result | `invoice_match_results`: invoice/request, `match_policy`, `match_status`, reasons, override audit | `id/invoice BIGINT`, request INTEGER. |
| AP Voucher | `ap_vouchers` + `ap_voucher_lines`; `ap_payables` is open-balance projection | BIGINT document IDs. |
| Payment | `payment_records`: request/voucher, status/reference/method/amount/actor/date; `payment_allocations` links payable | Existing payment authority, not a new table. SQL 006 adds invoice/idempotency linkage. |
| Budget | `budget_envelopes`: `allocated_amount`, `consumed_amount`; `commitment_ledger`: `request_id`, `budget_envelope_id`, lowercase `stage` (`reservation`, `encumbrance`, `actual`), `amount`, `currency`, `source_type`, `source_id`, `notes`, `actor_id`; SQL 006 adds `purchase_order_id`, `idempotency_key`, uppercase `state` (`ACTIVE`, `ACTUALIZED`, `RELEASED`, `REVERSED`) | There is no `commitment_type`, ledger `status`, `created_by`, `released_at`, or `released_by`. Availability uses active `stage='encumbrance'` rows. |
| Contract | `contracts`: supplier, status, dates, value/ceiling/balance/currency; no normalized contract-line/item pricing table | Supplier-level applicability exists; item price applicability is deferred/fail-closed. |
| Supplier Evaluation | `supplier_evaluations`: supplier ID/name and score/compliance fields; compliance documents in `supplier_compliance_artifacts` | Evaluation does not establish qualification/category eligibility. |

## Money policy

Authoritative service arithmetic parses decimal strings into four-place scaled `BigInt`, compares scaled integers, and rounds half-up to the two-decimal persisted currency scale. It never converts money to JavaScript `Number`. Quantities are persisted as `NUMERIC(18,4)` in Phase 4 additions. Currency codes are normalized/validated as three-character codes at API boundaries.

## Incorrect batch-1 assumptions and deferred facts

Batch 1 incorrectly referenced `purchase_requests`, used BIGINT for its INTEGER FKs, created a second `budget_commitments` authority, assumed budget `actual_amount/committed_amount`, used `po_id`, and treated arbitrary supplier eligibility and contract-price fields as proof. Category qualification, blacklist/suspension registry, and normalized contract line pricing do not exist in the checked-in schema and are explicitly deferred; governed contract item pricing must fail closed.

## Purchase-order status mapping

The existing status catalog is authoritative: service approval means `PO_APPROVED`, canonical release means `PO_ISSUED`, cancellation means `PO_CANCELLED`, and approval submission means `PO_PENDING_APPROVAL`. `APPROVED` and `RELEASED` are not persisted PO statuses.