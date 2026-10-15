# SCM intervention before final approval

SCM can open a request workspace and choose **SCM intervention**, enter a required
reason, and confirm **Reject and stop request** without waiting for their own
approval level. This is an exceptional request-level rejection, not a decision
on behalf of the current approver.

`POST /api/requests/:id/scm-rejection` accepts `{ "reason": "…" }`. Authorization
requires the actual SCM role, existing `requests.manage` permission, an institute
context, and a request in that same institute. Other roles (including users with
only `requests.manage`) cannot use the endpoint. No new permission or migration
is required. Unknown or cross-institute IDs return 404.

The request must still be in a pre-approval state and have pending or on-hold
workflow steps. Completed, finally approved, cancelled and other later states
are excluded. Existing purchased quantities, PO/receipt/RFx/procurement-event or
warehouse-supply records, linked contracts or financial evidence prevent intervention; their existing cancellation and
financial controls must be used instead. Requests without institute attribution
need legitimate organization data reconciliation before this action is available.

The service locks the request, demand lines and pending approval rows. In one
transaction it marks the request Rejected, supersedes/deactivates the remaining
parallel and future steps, writes request and per-step logs plus canonical audit,
and creates in-app notifications for the requester, initiating technician and
current approvers. Previous approved/rejected decisions and item identities are
preserved. The notification is not an email. Failure of audit or notification
insertion rolls everything back. Repeating the same actor/reason after success
returns the prior result without new logs or notifications.

Main, legacy and maintenance approval paths check rejected request state under
the request lock. Deferred HOD ranking continuation and legacy item procurement
updates reject stale actions too. Existing email approval links use the guarded
main approval path. The workspace shows the rejected summary, exposes history
and notes, and removes execution actions. Active priority queues already exclude
Rejected requests. Existing pending tasks disappear because their approval rows
are superseded and inactive.

This action does not delete submissions, reverse procurement/financial documents,
or reopen a request. Corrected submissions follow the existing new-request path.
Deploy backend and rebuilt frontend together; no SQL patch is needed. Production
acceptance should exercise an eligible request before SCM's level, a missing
reason, wrong role/institute, parallel approvals, requester notification, audit
history, a stale approval page and an already-procured request.

Validation uses mocks and a runner-created loopback PostgreSQL fixture. No shared
database writes or real messages are sent by these checks.
