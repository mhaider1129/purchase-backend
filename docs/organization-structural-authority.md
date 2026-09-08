# Organization structural authority

The organization hierarchy records **where authority applies**. Application roles,
permissions, and capabilities continue to record **what a user may do**. A position
assignment does not grant application permission, and the legacy `HOD` role does not
make its holder a structural department head.

Canonical heads are `DEPARTMENT_HEAD` for departments, `SECTION_HEAD` for sections,
`EXECUTIVE_HEAD` for executive offices, and `UNIT_HEAD` for other unit types. Current
resolution requires an active assignment whose effective dates include today. Zero
matches are unresolved and multiple matches are an ambiguous configuration error.

Executive ownership is found only by walking the unit's ancestor path to the nearest
executive office and resolving its executive head. `MEDICAL` and `OPERATIONAL`
classification remain reporting and future-policy attributes; they neither establish
the reporting parent nor imply CMO/COO approval.

Legacy HOD discovery combines the existing `users.role`/`user_roles` HOD evidence with
the user's department link. It is reconciliation input only. Administrators must
review assignments, configured organization heads are never automatically replaced,
and bulk reconciliation accepts only one active, same-institute, unambiguously linked
candidate with no current organization head.

For a future approval-engine cutover, structural resolution will first identify the
position holder and then separately require the relevant approval capability (for
example, `approval.department-head`). A missing capability must eventually fail closed.
This phase does not activate that routing behavior and does not alter approval snapshots.
## Position and capability boundary

An organization position records **where structural authority applies**. A role,
permission, or capability records **what system action is permitted**. A future
live Approval Policy cutover may require both checks; this hierarchy readiness
work does not enable that enforcement, remove the legacy HOD role, or change
historical approval snapshots.

Medical and Operational classifications remain descriptive metadata. Reporting
parents and executive ownership are resolved only from the organization tree;
classification never forces CMO or COO routing.