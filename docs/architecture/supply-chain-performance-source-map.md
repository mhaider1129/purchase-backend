# Supply Chain Performance & Workload source map

## Boundary and grain

A Procurement Case is one analytical container per approved `requested_items` row that enters Supply Chain responsibility. It is neither a request, RFx, award, PO, nor shipment. One case may link to many events and transaction lines. Draft and rejected requirements do not create cases. Approved unresolved Non-Stock requirements do create cases with `ITEM_IDENTITY_RESOLUTION`; Product/Catalog identity is not a prerequisite.

The implementation keeps transactions authoritative and stores only case-owned classifications, evidence coverage, governed complexity snapshots, overrides, highlights, and manual work evidence. RFx, award, PO, receipt, finance, inventory, supplier, and Item Master facts remain in their existing models.

## Repository audit

| Domain | Existing authority | Assessment / use |
|---|---|---|
| Requests/items/approval | `requests`, `requested_items`, approvals controllers/services, approval history | **SOURCE ALREADY EXISTS** for volume, departments, request timestamps and approval decisions. Item-level approval is the case trigger. |
| Assignment | request assignment controller and auto-assignment service/rules | **PARTIALLY AVAILABLE**: request-level buyer assignment exists; item-level case assignment is stored because mixed-item requests may have different buyers. |
| Procurement status/history | requested-item status controller, `procurement_item_events`, request lifecycle | **SOURCE ALREADY EXISTS / DERIVABLE**. Case status is a projection, not a new transactional state machine. |
| RFx and responses | `rfx_events`, `rfx_responses`, `rfx_response_items`, RFx portal/service | **SOURCE ALREADY EXISTS** for events, suppliers, quotation receipt, line values and timestamps. RFx-to-case linkage is deterministic through requested-item response lines; legacy request-only events have partial coverage. |
| Suppliers/contacts | `suppliers`, supplier principals/classification, SRM and evaluations | Supplier master/evaluation are **SOURCE ALREADY EXISTS**. Structured sourcing contacts are **PARTIALLY AVAILABLE**; off-system interactions require ledger entries. |
| Comparisons/technical evaluation | procurement evaluation cases/offers/criteria/scores/results; technical inspections | **SOURCE ALREADY EXISTS** at evaluation level; requested-item linkage and requested/completed event semantics are **PARTIALLY AVAILABLE**. |
| Awards | `procurement_awards`, award service/audit/outbox | **SOURCE ALREADY EXISTS** with requested-item, supplier, exact quantity/unit price/currency and source evidence. |
| Purchase orders | PO headers/items, award/requested-item traceability, PO lifecycle events | **SOURCE ALREADY EXISTS**. PO processing and awarded value are derivable per currency. |
| Goods receipt/inventory | goods receipt service/tables/items and inventory transaction engine | **SOURCE ALREADY EXISTS** for receipt evidence. Receipt is not automatically customs clearance or final end-user delivery. |
| Logistics/international | offer country-of-origin, shipping/customs cost, PO/GR dates | **PARTIALLY AVAILABLE**. Shipment entity, Incoterm, forwarder, AWB/tracking, permits, regulatory approval, customs status, dispatch/arrival/clearance dates are **MISSING**. No duplicate logistics table is introduced. |
| Contracts | contract governance, templates, approvals and evaluations | **SOURCE ALREADY EXISTS**, but requested-item/case linkage varies and is **PARTIALLY AVAILABLE**. |
| Payments/finance | supplier invoices, matches, vouchers, payment records/service | **SOURCE ALREADY EXISTS** for payment lifecycle. Normalized award/PO payment term and credit days are **PARTIALLY AVAILABLE** (free-text offer terms exist). |
| Budget | envelopes, commitment ledger, budget services | **SOURCE ALREADY EXISTS**; budget is not duplicated on a case. |
| Audit | `audit_logs`, audit service/registry/middleware | **SOURCE ALREADY EXISTS**. All manual case facts, activities, value verification, overrides and highlights must write here in the same transaction. |
| Communications/notifications | status/direct-purchase communications, notification outbox | **SOURCE ALREADY EXISTS** but not every communication proves a supplier procurement touch. Only semantically mapped events qualify. |
| Cycle timestamps | approval, RFx, award, PO, GR, payment timestamps | **PARTIALLY AVAILABLE**. Approval and PO clocks are derivable; commercially-ready, technical-request/decision, shipment/clearance and responsibility-segment boundaries have incomplete coverage. |

## KPI availability contract

`FULL` metrics return a value, including a legitimate zero. `PARTIAL` and `LEGACY_INCOMPLETE` metrics return `status: not_available`, a null value, and a coverage reason. Missing evidence is never rendered as zero.

| KPI | Availability | Source / rule |
|---|---|---|
| PRs received, requested items, departments served | **DERIVABLE** | distinct request/item/department rows in scope and date window |
| Requested value | **PARTIALLY AVAILABLE** | item estimated cost coverage varies; exact-decimal aggregation only |
| Pipeline counts | **DERIVABLE** for new cases | authoritative events projected using lifecycle precedence; legacy coverage incomplete |
| Complexity mix / PWU | **SOURCE ALREADY EXISTS after 010** | persisted versioned scoring snapshot; never inferred for history |
| Supplier interactions/touches | **PARTIALLY AVAILABLE** | qualifying activity types only; system events plus audited manual interactions |
| RFQs and quotations | **DERIVABLE** | RFx events/responses/response items; request-only legacy RFx cannot always split by item |
| New suppliers | **PARTIALLY AVAILABLE** | supplier creation provenance is not consistently tied to sourcing case |
| Negotiations | **PARTIALLY AVAILABLE** | governed activities; historical rounds are incomplete |
| Technical evaluations | **PARTIALLY AVAILABLE** | evaluation and inspection sources exist, but consistent case linkage does not |
| International cases | **SOURCE ALREADY EXISTS after assessment** | governed case fact plus supplier/origin evidence |
| Shipments/on-time delivery | **MISSING / PARTIALLY AVAILABLE** | no canonical shipment schedule/milestone authority; do not publish |
| Awarded value | **DERIVABLE** | active award/PO lines grouped by ISO currency; never sum currencies |
| Verified hard savings | **SOURCE ALREADY EXISTS after 010** | verified evidence event, baseline minus comparable final amount, per currency |
| Cost avoidance | **SOURCE ALREADY EXISTS after 010** | separately labelled evidence event; never combined with hard savings |
| Credit percentage / weighted days | **PARTIALLY AVAILABLE** | publish only after normalized terms/credit days cover denominator awards/POs |
| Median approval time | **DERIVABLE** | request submission to fully-approved event |
| Median sourcing time | **PARTIALLY AVAILABLE** | case sourcing start to commercially ready; new event coverage only |
| Median PO processing time | **DERIVABLE** | award to issued PO via traceable lines |
| Supplier/logistics lead time | **PARTIALLY AVAILABLE** | PO/GR exist, shipment milestones do not |
| Pending root cause count/value/age | **DERIVABLE for covered cases** | lifecycle projection or reasoned audited override; value remains per currency |
| Buyer workload | **DERIVABLE** | assigned cases, complexity snapshot, qualifying activities, RFx and case facts. PWU is capacity/workload context, not appraisal. |

## Lifecycle and clocks

Projection precedence is: closed/delivered evidence, logistics evidence, issued PO, award, commercial evaluation, technical evaluation, awaiting response, sourcing, item-identity resolution, ready for sourcing, approval pending. An override does not mutate RFx/PO/request state.

Durations are independent: submission→full approval; assignment/sourcing start→commercially ready; technical request→technical decision; award→PO issue; PO→dispatch; shipment→delivery; and submission→delivery. The last is explicitly end-to-end, not Supply Chain processing time. Responsibility clocks (`SUPPLY_CHAIN`, `END_USER`, `TECHNICAL`, `SUPPLIER`, `FINANCE`, `LOGISTICS`, `CUSTOMS_REGULATORY`, `APPROVAL`, `OTHER`) require paired event evidence; current coverage is insufficient for a complete attribution report.

## Activity capture decision

Canonical services should append idempotent activity rows in the same database transaction where their repository exposes the transaction: RFx created/sent, response submitted, award created, PO created/issued, and true delivery. The unique `idempotency_key` makes retries safe. Existing request-only PDF RFx generation is not treated as an RFx business event. Where legacy services do not expose a shared transaction, consume the existing notification outbox with an idempotent key; reporting failure must not roll back a core event. Page views and refreshes are never activities.

## Permissions and data scope

The migration seeds five permission definitions but grants none: view, manage, verify savings, executive view, and manage highlights. Routes must call permission helpers rather than compare role names, and every query must constrain institute scope from `data_scopes.institute_ids` (falling back to the authenticated user's institute). A buyer assignment never broadens scope.

## Historical and remaining blockers

No historical complexity, touches, savings, supplier interactions, responsibility time, or strategic achievements are backfilled. If cases are later deterministically backfilled from approved item rows, they must be `LEGACY_INCOMPLETE`. Remaining executive-release blockers are canonical shipment milestones, governed payment-term coverage, reliable technical evaluation-to-item linkage, supplier creation provenance, and validation of the new projections against a migrated production-like database.

## Connected event contract

The existing `notification_outbox` is the single committed-event transport. Its processor first projects performance evidence idempotently and then performs in-app delivery; a projection failure is recorded for retry and occurs after the producing business transaction has committed.

| Producer | Outbox `event_type` | Deterministic item identity in `payload` | Performance activity |
|---|---|---|---|
| RFx portal create | `RFX_CREATED` | `requestedItemIds` contains every linked request item | `RFQ_CREATED` on every active item case |
| RFx portal response | `RFX_RESPONSE_SUBMITTED` | `requestedItemIds` comes from persisted response lines | `QUOTATION_RECEIVED` on every relevant case |
| Award service | `AWARD_CREATED` | `requestedItemIds: [locked requested item id]` | `AWARD_CREATED` |
| PO service create | `PO_CREATED` | distinct IDs from persisted PO lines | `PO_CREATED` |
| PO service issue | `PO_ISSUED` | distinct IDs loaded from PO lines | `PO_ISSUED` |
| Goods receipt service | `GOODS_RECEIPT_POSTED` | distinct IDs from locked PO lines used by the receipt | `GOODS_RECEIPT` (not final delivery) |

Technical evaluation is deliberately still **PARTIAL**: the current evaluation records do not provide a reliable requested-item linkage on every path, so no technical lifecycle event is fabricated. New cases consequently begin with `activity_coverage = PARTIAL`; observing one event never upgrades the case to `FULL`.

Direct aggregate SQL with the supplied indexes is appropriate initially. Consider governed summary/materialized views only after measured query plans justify them; do not create a second reporting database.