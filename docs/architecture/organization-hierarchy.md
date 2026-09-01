# Organization hierarchy

## Decision and current model
Departments (`id`, name, medical/operational `type`, institute) and sections (`id`, name, department) are stable identities referenced by users, requests, and approval routes. Approval routing is versioned and historical approvals are snapshots. Extending departments alone cannot represent institutes, executive offices, directorates, or arbitrary units, so this module adds a normalized hierarchy layer and leaves every existing table and identifier intact.

**Organizational hierarchy is not itself the approval workflow.** Classification is metadata and never selects a parent: a Medical Nursing department may report to the CEO. The future workflow engine will combine hierarchy with request-type rules, financial thresholds, procurement policy, executive authority, and special approval requirements.

## Tables and migration
`organization_units` is a self-referencing adjacency list with optional unique links to an existing department or section. It stores institute scope, type, classification, ordering, active state, timestamps, and actors. `organization_positions` separates authority/people from units, supports unit/executive/department/section heads and custom positions, effective dates, and soft archive. Foreign keys, indexes, checks, an application guard, and a recursive database trigger reject self-parenting and cycles.

Migration `purchase-backend/sql/migrations/20260901_organization_hierarchy.sql` is additive, transactional, and idempotent. It upserts every department as an initially unparented `DEPARTMENT` node and every section below its department node. It neither changes department classification nor touches users, requests, routes, route versions, approvals, or snapshots. Administrators can subsequently add institute/executive nodes and move the bootstrapped nodes.

## Resolution and positions
Recursive queries provide ancestors, descendants, and paths. Executive ownership walks from a unit toward the root and uses the nearest `EXECUTIVE_OFFICE` node's active `EXECUTIVE_HEAD` (or active unit head). Department and section resolvers locate the linked legacy record, then resolve the corresponding active typed position. Reusable service methods are `getAncestorUnits`, `getOrganizationalPath`, `resolvePositionHolder`, `resolveDepartmentHead`, `resolveSectionHead`, and `resolveExecutiveOwner`. No approval resolver calls them in this phase.

## API, authorization, and audit
Authenticated reads: `GET /api/organization/tree`, `/units`, `/units/:id`, `/units/:id/positions`, and `/resolve/:departmentId`. Unit filters include type, parent, institute, active, classification, and search. Permission `organization.manage` protects unit create/update/archive/move and position create/update/archive. It is initially granted to SCM by the existing permission synchronization convention; administrators can assign it to other roles.

All writes share their database transaction with an audit entry. Events are `ORGANIZATION_UNIT_CREATED`, `ORGANIZATION_UNIT_UPDATED`, `ORGANIZATION_UNIT_MOVED`, `ORGANIZATION_UNIT_ARCHIVED`, `ORGANIZATION_POSITION_ASSIGNED`, `ORGANIZATION_POSITION_CHANGED`, and `ORGANIZATION_POSITION_REMOVED`; before/after data includes parent and holder changes.

## Frontend and future work
`/admin/organization` provides a responsive visual tree with connectors, search, expansion, zoom, fit reset, node detail panel, and a secondary table. The editor uses linked department/section IDs rather than creating duplicates. Deliberate moves require the explicit move endpoint; drag/drop is deferred until a reliable confirmation interaction is available.

The next phase should add dynamic approval-step resolvers behind new, versioned route-rule types, snapshot every resolved user/unit into the request's approval generation, and retain the existing resolver as the default. Roll out with shadow comparison before any route uses `DEPARTMENT_HEAD`, `SECTION_HEAD`, or `EXECUTIVE_OWNER`.