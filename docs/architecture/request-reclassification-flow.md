# Request reclassification flow

## Audited current behavior

`PUT /api/requests/:id/request-type` routes through `requestsController` to `rewireRequestType` in `updateRequestsController`. Previously the controller authorized the literal `SCM` role, opened its own transaction, locked the request, resolved a domain and configured route, directly updated type/domain/status to `Submitted`, deleted every approval, called legacy `initializeApprovals`, inserted `request_logs`, and committed. It produced neither a central audit event nor an outbox event. This destroyed decisions, allowed unsafe status resets, coupled HTTP and business logic, and could not express institute/department exceptions.

Direct-write review found the rewire path writing `requests.request_type`, `requests.request_domain`, `requests.status`, `approvals`, and `request_logs`. Other controllers still write request status/log rows and are explicitly outside this consolidation. `initializeApprovals` inserts/activates approvals and uses role assignment; the shared resolver creates immutable route snapshots, while the shared engine creates and activates steps.

## Connected architecture

The controller now parses input and calls `requestReclassificationService`. One `withTransaction` transaction locks the request, applies `requestPolicy` with `requests.reclassify` and scope permissions, permits only Draft/Submitted/Pending/Returned, resolves domain and route, snapshots it, uses the lifecycle service for a controlled reset, uses the approval engine to supersede (never delete) old steps and create new ones, records `request.reclassified` through `auditService`, and enqueues an outbox event. Database constraints prevent more than one current active approval.

SCM receives `requests.reclassify` by default. Cross-institute, cross-department, and cross-section work still requires the corresponding explicit scope permission. `request_logs` remains UI compatibility history elsewhere; long term, UI history should read central audit events through a compatibility view/adapter rather than receive new handwritten inserts.