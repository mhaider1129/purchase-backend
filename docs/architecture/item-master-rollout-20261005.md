# Item Master rollout and request resolution

## Problem and behavior

PR #10 introduced strict item identity checks, but the request workspace did not expose resolution, and the Item Master hierarchy had search without creation. The visible creation form wrote legacy data that the normalized request selector deliberately could not find.

This change adds a usable governed workflow and an explicitly managed temporary free-text allowance. Strict enforcement remains the default. Existing approvals, supplier eligibility, quantities, product restrictions, controlled inventory receipts, budget and finance rules remain enforced.

## Operator steps

1. Apply the migration below manually and deploy both applications after reviewing and merging the Draft PR.
2. In **Management → Item Master policy**, keep **Require resolved Item Master identity before procurement** on for strict behavior. Turn it off with a reason during catalog setup to allow description-only procurement. Only users with `permissions.manage` can change this global policy; changes and compatibility commands are audited.
3. In **Item Master → Reference data**, set up categories, UOMs and manufacturers as needed. Use **Create Generic Item** in the main hierarchy. This writes `generic_items`, not the legacy catalog.
4. Complete the Generic lifecycle in order: draft → review → validation → approval → active. Only active Generic Items can be selected in requests. Creation does not skip approval or duplicate review.
5. For governed physical quotations/awards, create a Product for the active Generic Item, approve it, then create a Supplier Catalog offer with its purchasing UOM and conversion. Generic creation uses equal base and inventory UOMs; Product and supplier packaging retain explicit conversions.
6. Open an approved request workspace, choose **Review item identities** or **Items → Resolve identity**, select an active Generic Item, and record a reason. The line ID, requester wording and quantity remain intact. An active pending referral is closed and audited when resolved here.
7. If no suitable item exists, use **Cannot find the item** in the resolution dialog to refer it to the **Pending Item Master requests** queue. A steward can link an active Generic Item, ask for more information, reject the referral or authorize an exception with the separate exception permission.
8. In **Stock Mapping Workspace**, search/filter existing stock, choose a Generic Item and optional approved Product, propose, review, and approve with a reason. Approval checks the existing quantity unit before applying the controlled inventory UOM; balances never convert implicitly. History includes versioned replacement/restoration actions for users with override permission.

Legacy creation remains explicitly labeled inside a collapsed historical compatibility workspace. Historical legacy rows are not automatically copied, merged, reclassified or made request-selectable.

## Policy semantics and safeguards

| Identity | Strict on | Temporary compatibility |
| --- | --- | --- |
| Active catalogued Generic / validated preference or restriction | Existing governed rules | Same governed rules |
| Authorized service / approved catalog exception | Existing rules | Same rules |
| `free_text` or historical NULL mode, no catalog IDs, NULL/pending mapping status, non-stock/direct-delivery/consignment or unspecified stocking policy | Resolve first | May proceed as non-inventory procurement; remains unresolved and audited |
| Pending Item Master creation referral | Steward decision required | Steward decision required |
| Invalid mode, inconsistent status, stock/service stocking policy on a description-only line, or attached unresolved physical IDs | Blocked | Blocked |

Compatibility applies to sourcing, RFx quotation submission, awards, PO creation and both procurement-progress interfaces. It does not grant an approved free-text exception. Physical catalog IDs cannot be attached to unresolved compatibility lines.

Each compatibility command reads and locks the persisted policy in its transaction. Re-enabling enforcement waits for in-flight compatibility commands and blocks subsequent unresolved procurement commands. No cache extends the allowance. Existing PO snapshots and downstream receipt/invoice/payment processing are preserved. Finish outstanding compatibility sourcing/award-to-PO work before re-enabling strict enforcement, or use an approved document revision workflow; consumed lines cannot be silently reclassified through resolution or referral.

Missing policy migration or singleton defaults to strict behavior and disables the Management switch. SQL errors fail the command rather than allowing procurement. The effective policy is readable by authenticated application users; writing requires server-side `permissions.manage`.

Mapping commands serialize on the stock item before locking mapping records, retain expected-version checks, and validate active master identities. Joined Item Master lookups lock only their primary records (`FOR SHARE OF gi/ap`), avoiding PostgreSQL's prohibition on locking nullable joined rows. Proposals, decisions, replacements and restorations are audited.

## Permissions

- View hierarchy and request catalog: `item-master.view`.
- Generic draft creation: `item-master.create`.
- Generic review: `item-master.edit`; validation/approval-stage preparation: `item-master.validate`; activation: `item-master.approve`; retirement: `item-master.retire`.
- Reference maintenance: `item-master.references-maintain`.
- Product creation/approval: `item-master.products` / `item-master.products.approve`.
- Supplier Catalog creation: `item-master.suppliers`.
- Request resolution / pending queue: `item-master.map`.
- Approved free-text exceptions: `item-master.free-text-exception`.
- Stock mapping: `item-master.stock-map`; replacement/restoration: `item-master.stock-map.override`.
- Global policy: `permissions.manage`.

No permissions are granted automatically by this change. Use Management's existing permission controls to assign responsibilities explicitly.

## Database changes

**MANUAL DATABASE MIGRATION REQUIRED**

`purchase-backend/sql/development/20261005_03_procurement_identity_policy.sql`

Apply manually in the confirmed Development project first. The additive, idempotent migration creates one configuration row, defaults to strict enforcement, enables RLS, preserves existing settings on reapplication, and checks that Item Master audit support exists. It does not modify requests, catalog, stock balances, legacy data or existing documents. No live Supabase connection or migration was executed by Codex. Production application remains an owner-controlled deployment decision.

## Validation and limits

- PASS: backend Jest (178 suites / 1,309 tests), frontend Jest (54 suites / 217 tests), disposable PostgreSQL (29 tests), changed frontend ESLint, changed backend syntax checks, diff whitespace checks and production frontend build.
- Repository-wide frontend lint remains FAIL on two pre-existing PhysicalInventory.test.jsx errors; the build retains the existing PhysicalInventory hook and DepartmentRequestedItemsBoard unused-variable warnings.
- PostgreSQL tests run only against the guarded disposable loopback Docker database. They execute the migration twice, preserve a changed setting, exercise free-text and NULL-mode award-to-PO flows, strict re-enablement, policy locks, sourcing/quotation checks, unit validation, proposal audit, concurrent mapping approvals and concurrent workspace/steward referral resolution.
- UI tests cover Management on/off behavior, normalized creation, each Generic lifecycle step, the request workspace resolution path, mapping errors and versioned restoration.
- Development end-to-end testing with real users/permissions is still required after manual migration and deployment. Automated tests do not establish live Development schema parity or production readiness.
- Existing unrelated lint/build warnings in PhysicalInventory and DepartmentRequestedItemsBoard are recorded separately. Existing invoice/payment/AP behavior is covered by the retained backend/P2P suites, not redesigned here.
