# Using departmental and organizational request priorities

Each active request occupies **one position**, regardless of its item count.
Department and institutional orders are independent. A request stays visible
while it has eligible active procurement items and a non-terminal request status.
Completed, rejected and other terminal requests leave the active queues; rank and
assessment history is retained. Fulfilling one item does not remove its request
while another item remains active.

## Department workflow

Open Insights & Analytics → Department Priorities, or
`/procurement-priorities/department`. The user needs
`procurement-priority.rank-department`; access is scoped to the signed-in user's
institute and department. Review the request link and its items, move the whole
request to its desired position, then Save Changes. Even a single new request
can be saved without moving it. Cancel restores the loaded order. A conflict
keeps the draft and offers Reload latest queue; reload discards the draft.

HOD ranking-gate responses now have `grain: request`, `requiredRequestIds`, and
one queue row per request. The ranking submission uses `ordered_request_ids` and
`snapshots`; ranking and approval continuation remain one transaction. Item case
IDs remain inside each request for version checking and assessment purposes.

## SCM workflow

Open Insights & Analytics → Priority Management, or
`/procurement-priorities/manage`. Access needs `procurement-priority.manage`;
saving the organizational order needs `procurement-priority.override`.
Use filters to investigate requests, then clear filters to reorder the complete
active queue. A deviation from the system suggestion needs a reason. Saving an
organizational order does not change the department order or item assessments.

The request's suggested tier and score come from its most urgent active item:
tier P0 through P4 first, then highest score, then case ID to break ties. Scores
are never summed, so adding more items cannot artificially raise priority.
Unassessed requests remain unassessed. Suggested positions use tier, score and
request ID. The request's age is the oldest active case age. Item factors remain
item-specific: open the request row and use **Item assessment** to review and
assess each item. The departmental factor denominator counts requests, not items.
The group filter matches any group attached to an active item in the request.

## Existing ranks, concurrent edits and public visibility

SQL 047 adds `request_priority_rankings`, with one row per request and separate
department/institutional rank fields. Until a request-level order is saved, its
highest existing active item position initializes the request position. Equal
positions break by request ID. Reads normalize gaps caused by completed requests;
legacy item rank/history records are never rewritten or deleted.

Saves validate the complete active request set, the request rank version, and
all active item profile versions/membership. Concurrent queue edits, assessment
changes, newly added items and request completion cause a 409 with reload guidance.
One institute-scoped transaction lock serializes priority writers, including
first saves without existing rank records. Audit entries contain before/after
request orders and their case membership. Current request ranks take precedence
in item details and subsequent assessment calculations/history.

Public Institutional Priorities combines explicitly public item titles into one
request entry, without publishing private item titles or descriptions. Its tier
and score band use only public items. Saving internal rank does not publish a
request. Existing manually curated public groups remain separate collection
entries; they are not additional request positions in either reorder workspace.
If a menu is absent, review existing capability grants in Management. Group
management needs `procurement-priority.manage-groups`; the public view needs
`procurement-priority.view-public`. No new role grants are introduced.

## Deployment

**MANUAL DATABASE MIGRATION REQUIRED**:
`purchase-backend/sql/manual/047_whole_request_priorities.sql`.

1. Apply SQL 047 in the Supabase SQL Editor after the existing priority foundation
   (012 or the reconciled equivalent). It adds the request-rank table and indexes;
   repeat application preserves existing request ranks and versions. It enables
   RLS and grants no browser/direct-client access. The backend database role must
   own the table or have appropriate server-side table privileges and RLS access,
   consistent with the existing backend connection model.
2. Deploy the backend and rebuild/publish the frontend from this change together.
   Backend first is supported: old item-level mutation endpoints return a 409
   requiring a client refresh, rather than silently splitting a request order.
   Old departmental/HOD payloads must be upgraded to the new request contract.
3. Hard-refresh clients. Check a multi-item request appears once in each internal
   list; save different department/organizational orders; complete a test request
   and refresh to confirm it leaves both lists. Open views refresh every 30 seconds
   or on tab return when there is no unsaved edit.

No production or Supabase connection is used by the automated tests. The local
PostgreSQL harness applies SQL 047 twice, checks populated-record preservation,
then exercises multi-item ordering, stale snapshots, scope, privacy and completion.
The request-level contract intentionally replaces the old item reorder contract;
item assessment, group membership and historical item data remain available.
