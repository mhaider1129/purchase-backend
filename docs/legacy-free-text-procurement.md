# Legacy description-only procurement during catalog setup

The original Item Master foundation migration populated existing description-only
request lines with `request_mode=approved_free_text_exception`,
`catalog_status=approved_exception` and `stocking_policy=non_stock`, but did not
populate `restriction_justification`. The strict procurement validator requires
that justification for a genuine approved exception. Before this correction,
the temporary compatibility policy accepted only null/free_text modes, leaving
these historical records blocked even when enforcement was explicitly disabled.

The shared command gate now includes the legacy exception state without a
justification in the temporary description-only allowance. It still requires a
saved policy with enforcement explicitly false, locks that policy and records
`procurement.compatibility_used` with the actor, request, line and policy reason.
It does not add a justification, reclassify the item, or mark it procurement-ready
under strict enforcement. Re-enabling enforcement blocks new commands for this
unresolved state.

Stocked lines, physical catalog IDs, rejected lines, pending referrals, invalid
modes and mismatched catalog states remain outside the allowance. Existing
request access, supplier, quantity, overage and inventory receipt checks remain
in place. New exception creation still requires elevated permission and a real
justification; this is not a substitute for steward approval.

No SQL migration or data update is required. Deploy/restart the backend after
merging. Existing frontend policy controls are sufficient. Verify the policy is
saved as off and retry the failed command once. If it still fails, inspect the
line's `restriction_justification` and identity fields and confirm the backend
contains this change. A nonempty justification already passes the existing
strict exception check for the supplied state; continuing failure would suggest
different deployed code or data.
