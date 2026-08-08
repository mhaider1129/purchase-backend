# Canonical parallel approval semantics

## Model and identity

An approval route is sequential **between levels** and unanimous **within a level**. A level is an ordered integer and may contain one or more required members. A versioned member is identified by `(request_id, approval_route_version, approval_level, approver_id)`. The snapshot exposes grouped `levels[].members[]` and retains flat `steps[]` for historical consumers.

Current workflow reads exclude superseded rows and use exactly one route identity: route version when present, otherwise snapshot identity, otherwise the explicitly legacy/unversioned workflow. They never combine these three populations.

## State rules

1. **Activation.** When a level becomes current, every non-superseded, undecided `Pending` member in that level becomes active. No other level is activated. Repeating activation is harmless because only inactive rows are returned and notified.
2. **Member approval.** Approval decides only the acting member. Other members remain active. The engine returns counts for the current level and does not advance while any required member is Pending.
3. **Level completion.** The level completes only when every current member is Approved. The engine then activates every Pending member at the next greater level. If none exists, `requestLifecycleService` transitions the request to Approved.
4. **Rejection.** Any active member may reject the request. That member is preserved as Rejected, remaining active Pending members in the same level are deactivated, later levels stay inactive, and the lifecycle service transitions the request to Rejected.
5. **Return for correction.** `Returned` is an existing validated decision and lifecycle state. For compatibility, one active member may return the entire cycle. Remaining Pending members in that level are deactivated, later levels stay inactive, history is preserved, and the lifecycle service transitions the request to Returned.
6. **Reassignment.** One undecided, non-superseded member is reassigned in place, preserving level, version, snapshot, status, and activity. A reason is mandatory. Reassignment to an existing member of the same version and level returns a 409. An active reassignment creates an action-required outbox event for the replacement.
7. **Supersession/reclassification.** Reclassification allocates the next version, supersedes and deactivates the old workflow without deleting it, stores a new immutable snapshot, creates its members, and activates its minimum level. Historical queries may show every version; actionable queries may not.

## Concurrency, audit, and notifications

The deterministic lock order is: discover the target identity without locking; lock the request `FOR UPDATE`; lock all non-superseded rows in the selected workflow ordered by `(approval_level, id)`; decide the member; derive completion in the same transaction; then activate or transition. The request lock serializes two final-member decisions, so only the transaction observing unanimous completion advances the route. Audit and outbox writes use the same transaction and therefore roll back with the decision.

Each member decision has an approval audit event. A completed level has a separate structured event with request, route version, snapshot, level, member/approved/rejected/pending counts, and next level. Activation emits one outbox event per newly active member with `approval:{approvalId}:active:{routeVersion}`; an already-active row is not returned, preventing duplicate activation messages. Final request notifications come from the lifecycle outbox integration.

## Delegation boundary

The legacy SCM → HOD → SCM path in `approvalsController` remains a sequential temporary delegation/sub-step outside the canonical engine. It is not group membership and was not converted into a parallel requirement. Its safe migration requires an explicit sub-step model; Phase 2 preserves it and records it as technical debt.

## Route administration compatibility

Multiple distinct route rules may share an approval level. Only an identical member repeated within the same level is invalid. Role-based members must resolve to concrete users before `createSteps`; selecting a single user for one role definition is not permission to collapse multiple independently configured definitions.