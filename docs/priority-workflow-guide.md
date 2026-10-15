# Using departmental and organizational priorities

The current canonical ranking is per procurement requirement (one item-level case),
not one position for an entire multi-item request. Department and SCM orders are
separate facts. Changing one does not silently replace the other. This change
repairs saving and usability without changing that grain or the scoring weights.

## Department workflow

Open Insights & Analytics → Department Priorities, or
`/procurement-priorities/department`. The user needs
`procurement-priority.rank-department`; the endpoint is scoped to that user's
institute and department. HOD-approved active requirements receive neutral
coverage when needed, preserving existing assessments and rankings.

Review the request reference link and requirement description, move the most
important requirement to the top, and choose Save Changes. A single unranked
requirement can be saved as rank 1 without moving anything. Success is explicit;
Cancel discards an unsaved move. A conflict keeps the draft order and offers
Reload latest queue. Reload replaces the draft with current data, so review and
reapply the intended order after another person changes the queue.

## SCM workflow

Open Insights & Analytics → Priority Management, or
`/procurement-priorities/manage`. The user needs `procurement-priority.manage`
to open the workspace and `procurement-priority.override` to save the institution's
order. Use filters to investigate requests, then clear filters to reorder the
complete active queue. Review system score/tier and department rank, move entries,
and save the institutional order. An order differing from the system suggestion
requires a reason. Missing assessments are not fabricated by manual ranking.

The displayed unfiltered positions are the proposed order. Saving is guarded
against duplicate clicks and concurrent edits. A failed save shows a recoverable
message rather than an uncaught promise error. Request links open the source
workspace for review. Internal titles can fall back to the request item's name;
this fallback does not publish private request descriptions.

## Access and public view

If a menu is missing, review the relevant capability grants in Management; a role
name alone does not grant priority access. Group management additionally needs
`procurement-priority.manage-groups`. Public Institutional Priorities requires
`procurement-priority.view-public` and displays only explicitly public profiles
and public active groups. Saving an internal organizational order does not make
private requirements public. Creating a reviewed public group is an existing
publication route; automatic publication is not added here.

## Active requests, history and deployment

Completed/rejected/other terminal requests remain excluded by the shared active
eligibility checks. Open views retain their 30-second/tab-return refresh, paused
during unsaved changes. History is preserved. Version snapshots are keyed by case,
so differing assessment/history versions do not prevent a legitimate department
reorder. Stale versions still fail before writing. Legacy scalar department
clients remain supported when every case has that version. Versioned SCM clients
also reject concurrent changes; legacy unversioned SCM payloads keep their prior
contract until those clients are upgraded.

No migration is required. Deploy the backend first, then rebuild/publish the
frontend so the new per-entry version payload is supported. Scope changes from
item-level to whole-request priorities require a separate explicit design choice.
