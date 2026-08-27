# Procurement Priority source map and foundation

## Boundary and vocabulary audit

Repository-wide searches covered `priority`, urgency/emergency/critical, queue/rank, escalation/aging,
deadline/strategic and stockout/service interruption. The terms below are not interchangeable.

| Existing concept | Location | Classification | Decision |
|---|---|---|---|
| `requests.is_urgent`, urgent submit toggle and `requests.mark-urgent-on-submit` | request controllers, forms, permission catalog | REQUESTER_DECLARED, LEGACY, TO_MIGRATE | Retain as an approval-attention flag; never score it directly or present it as institutional priority. |
| request workspace `priority` projection / `emergency_flag` | `requestWorkspaceController` | DISPLAY_ONLY, SYSTEM_DERIVED, LEGACY | Keep compatibility projection; it is not authoritative IPPS data. |
| direct-purchase `urgency_reason` communications | communication hook/controller | REQUESTER_DECLARED, DISPLAY_ONLY | Communication evidence only. Email/reminder volume never scores. |
| Item Master `criticality` | migration 20260727 and Item Master UI | AUTHORITATIVE for item governance, DISCONNECTED | May support governed service-risk evidence after review; it is not itself Priority. |
| contract obligation `priority` and escalation clauses | contracts controller | AUTHORITATIVE for contract obligations, DISCONNECTED | Preserve distinct meaning. A verified consequence may be separately assessed in IPPS. |
| supplier/regulatory risk `critical` | supplier schema/controllers | AUTHORITATIVE for supplier risk, DISCONNECTED | Supplier difficulty does not score. |
| risk-register criticality | risk management controller | AUTHORITATIVE for enterprise risk, DISCONNECTED | No automatic Priority mapping. |
| assignment and incomplete queues | navigation/controllers | DISPLAY_ONLY | Workflow collections, not priority rankings. |
| invoice matching aging bucket | procure-to-pay controller | SYSTEM_DERIVED, DISCONNECTED | Finance aging, not procurement-priority aging. |
| `procurement_cases.strategic_highlight` | manual SQL 010 | SCM_GOVERNED for performance display, DISCONNECTED | Never awards strategic points. IPPS requires an approved initiative link. |
| procurement complexity and PWU services | procurement performance services | AUTHORITATIVE for their own models, TO_RETIRE from priority inputs | Conceptually and mathematically excluded from IPPS. |

No pre-existing field represents a governed, item-grain institutional priority score. The new profile
therefore does not duplicate a clear existing meaning.

## Canonical grain and eligibility

The canonical grain is **`procurement_cases`**, which already has one active case per
`requested_item`. This preserves mixed-priority lines inside one purchase request and provides the
stable identifier used by performance without combining their formulas. Whole-request priority is
only a read projection (maximum active line score). Canonical active eligibility is centralized in
`procurementPriorityService.isActivePriorityCase`; terminal status vocabulary includes completed,
received/delivered, rejected, cancelled, closed, and available in stock.

## HOD departmental ranking

`department_priority_rankings` is an effective-dated history. Its current row contains rank, active
queue total, actor and timestamp. Rank contribution uses the relative formula
`(total-rank)/(total-1) * 15`, with a single-item queue receiving 15. A reorder command must lock the
department's current rows in one database transaction, verify actor department and institute scope,
verify the complete active ID set and optimistic `row_version`, shift/normalize positions, close old
ranking rows, insert new rows, audit once, then recalculate every affected profile. The pure service
validates the ordering contract; the persistence endpoint remains blocked until migration 012 is
deployed and the repository transaction adapter is implemented.

The current parallel approval engine has no safe shared transaction with this pending schema.
Therefore this foundation does **not** alter approval behavior. Deployment must add a controlled
`HOD_RANKING_REQUIRED` post-decision gate, or atomically rank within the existing approval transaction,
before progression. Until then, the “approval must enter queue” requirement is an explicit blocker,
not a fabricated second approval engine.

## IPPS-1.0 model

Authoritative arithmetic uses integer hundredths in Node and `NUMERIC(5,2)` in PostgreSQL. Weights
exist only in backend constants: controlled impact 25; reasoned SCM assessment 20; normalized HOD
rank 15; capped supply-chain-owned aging 10; evidence-backed stockout/service risk 10; deadline 8;
institutional dependency 5; regulatory/contract consequence 4; approved initiative 3. Spend,
international sourcing, complexity, PWU, messages, reminders, department size, and supplier
difficulty are absent from inputs.

Controlled scales are exported by the service. Impact ranges from convenience through patient
safety/essential service. Risk ranges from no effect through out-of-stock, and can also describe
equivalent non-stock service interruption without requiring a stock item. Deadline, dependency and
regulatory levels are controlled; their profile fields preserve reason and evidence. High-factor
justification is enforced in the persistence validation planned with the endpoint. SCM assessment is
an integer 0–100 with mandatory reason and contributes `assessment / 100 * 20`. Strategic points are
awarded only for an approved initiative link. Aging begins at reliable `supply_chain_owned_at`, not
draft creation: 0/2/4/6/8/10 for 0–14/15–30/31–45/46–60/61–90/91+ days.

Tiers are P0 90–100, P1 75–89.99, P2 60–74.99, P3 40–59.99 and P4 0–39.99. P0 requires a reason;
no executive approval was invented. Missing evidence produces `NEEDS_ASSESSMENT`, not a misleading
low score.

## Ranks, history, recalculation and groups

`system_score` and `system_suggested_rank` remain calculated facts. `institutional_rank` is a separate
SCM-governed order; an override requires a reason and does not change score. Every successful
recalculation appends a history snapshot with exact score, tier, factor JSON, model, trigger, actor,
timestamp and then-current institutional rank. Old snapshots are immutable.

Relevant events should recalculate synchronously. The repository has periodic utility timers but no
durable general job runner. Deployment should invoke a daily idempotent batch from external cron;
until then, backend queue reads may deterministically identify stale aging profiles and enqueue a
bounded recalculation (never calculate all rows in React).

Groups contain procurement-case IDs, never text matches. Derived group score/tier is the maximum
active member score. Terminal members are ignored; all-terminal groups close. A public tier or rank
override requires SCM permission, reason, and audit. Public serialization is allow-listed to group or
safe public title, rank, tier/approved score band, age, high-level impact, status, and member count.
It excludes supplier, quotation, price, technical detail, notes, and private cross-department fields.

## Surfaces, security and audit

The frontend foundation includes a compact authenticated homepage widget, explainable factor table,
permission-controlled HOD queue controls, and SCM override form. General users receive only the
public institutional read model; HODs can reorder their own scoped department; SCM capabilities
manage assessment/factors/rank/groups. Neither a role name nor client controls are authorization.
Migration 012 adds granular capability codes; APIs must enforce them plus institute scope.

The canonical audit service must record HOD reorder, assessment/factor changes, tier/rank overrides,
group/member changes, public visibility and all score-affecting manual facts in the same transaction.
Migration 012 is pending/manual, uses preflight, creates profiles, effective-dated rankings, immutable
history and group membership, and intentionally performs no fabricated historical rank or SCM
assessment backfill.

## Deployment blockers

1. Review and manually deploy SQL 012 through the database runbook.
2. Implement repository transactions/RLS policies and API serializers against the deployed contract.
3. Select and implement the approval-engine `HOD_RANKING_REQUIRED` transaction boundary without
   changing parallel approvals.
4. Confirm the approved institutional initiative source before adding its foreign key.
5. Confirm institute/department foreign-key table names and the exact “available in stock” semantics.
6. Configure a durable daily recalculation job and operational monitoring.