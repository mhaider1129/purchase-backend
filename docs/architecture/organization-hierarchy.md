# Organization hierarchy

## Boundary and governed schema

**Organizational hierarchy is not an approval workflow.** Hierarchy answers who reports to whom; a later policy engine will answer what approvals are required. Migration `sql/manual/014_organization_hierarchy.sql` is additive and independent from the Spare Parts migration 013. It creates only `organization_units` and `organization_positions`; departments, sections, users, and institutes remain canonical.

A department or section identity link is optional, immutable through the current service, unique, and legal only on the matching unit type. Database guards prove that parents and legacy identities belong to the unit's institute. The existing users table has a direct `institute_id`, so assigned holders are also checked against the unit institute. Vacant positions remain legal.

Bootstrap creates unparented department nodes and sections beneath their linked departments. Classification is copied as metadata only. It never infers an executive parent, so a medical Nursing department may report to CEO and later move to CMO without changing classification.

## Mutation, concurrency, and authority policy

All writes use the canonical organization service and share a transaction with their audit event. A failed audit rolls back the mutation. Moves have a distinct operation and event, lock the moved row and target parent, and perform same-institute and recursive cycle validation in that transaction. Generic edits cannot change parent, unit type, or legacy identity.

Unique authority uses **Policy A**: each unit can have at most one active `UNIT_HEAD`, `EXECUTIVE_HEAD`, `DEPARTMENT_HEAD`, or `SECTION_HEAD`, regardless of effective range. This deliberately trades scheduled overlapping successors for deterministic resolution; archive the prior authority before activating its successor. `CUSTOM` positions may repeat. A separately marked active unit head is also unique. Resolution additionally requires `effective_from <= current_date <= effective_to` where bounds exist. Future, expired, archived, and vacant holders do not become principals. Runtime ambiguity (including legacy corrupt data) returns a controlled conflict rather than selecting the first row.

Executive ownership walks upward and selects the nearest `EXECUTIVE_OFFICE`, then its current `EXECUTIVE_HEAD`; an explicitly unique current `UNIT_HEAD` is the documented fallback. Missing authority returns unresolved (`null`).

## Future Approval Policy Engine 2.0 (design only)

No live approval code consumes this module. Future resolver vocabulary may include `REQUESTER`, `DEPARTMENT_HEAD`, `SECTION_HEAD`, `EXECUTIVE_OWNER`, `POSITION`, `CAPABILITY_HOLDER`, and `FIXED_AUTHORITY`. Conditions may use request type, department, ancestry, classification, amount, warehouse, item category, payment requirement, stock status, maintenance, and medical-device rules.

Dynamic routing must first run in **shadow mode**: the existing engine remains authoritative while the new engine proposes a route. Compare resolved steps, users, order, conditions, and duplicates for every PR; do not switch authority until parity and policy validation pass.

Duplicate principals require semantic treatment. For example, CEO may appear once as `EXECUTIVE_OWNER` and again for a policy attestation. The future engine must distinguish the same principal with the same approval meaning from the same principal performing distinct statutory or policy meanings. It must not apply simplistic user-id deduplication.