# Attachment authorization and legacy file compatibility

## Revalidation and scope

AUD-003 and AUD-015 were revalidated against master `d85a642d` (merged audit PR74). `/uploads` still used unauthenticated express.static; request/item/contract file handlers did not authorize the parent; path aliases selected filesystem objects without registered-record visibility; `/files` imported nonexistent getSignedUrl/deleteS3File and expected obsolete s3_key. Existing SQL054 already defines the retention FK; that protection is preserved. Its deployed installation was not inspected.

This change addresses file access only. It does not cut over approval routing, redesign finance or procurement, connect to hosted databases, deploy, or change frozen migrations. **No database migration required.**

## Canonical authorization

`services/attachmentAuthorizationService.js` is the object policy. `controllers/attachmentsController.js` owns attachment metadata/list/upload/download/delete commands. It reloads the active user, actual institute, effective permissions and data scopes from database authority; frontend institute IDs, stale permission lists and raw storage paths confer no rights.

Two checks apply: an action capability derived from the existing parent workflow, and actual access to that specific parent within institute scope. Requester ownership and current approver/technical assignments are existing delegated parent capabilities; these workflows have no separate global attachments permission and do not receive a new blanket permission. An assignment alone does not make someone an attachment manager. Generic procurement capability without a matching assignment also fails.

| Principal                                  | Read / append                                                                                                                        | Delete                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Requester / initiating technician          | Own request; inherited submission/evidence capability                                                                                | Own uploaded file, only while not retained           |
| Approver                                   | Nonsuperseded approval on the current route (append requires an active or decided step) on this request                              | No deletion authority from approval assignment       |
| Assigned buyer                             | Current request/item assignment **and** procurement.update-status                                                                    | Requires requests.manage; assignment is insufficient |
| Technical / delivery / demo reviewer       | Current departmental assignment; read only selected review evidence or their own newly uploaded evidence; append supporting evidence | No deletion authority from review assignment         |
| Request manager                            | requests.view-all for read; requests.manage for append/delete                                                                        | requests.manage, subject to retention                |
| Technical manager                          | Existing technical-inspections.manage plus existing SCM/Admin/ProcurementSupervisor role                                             | Requires the separate request management capability  |
| Contract creator/manager/assigned reviewer | Verified contract relationship or contracts.manage, with unambiguous scope                                                           | contracts.manage, subject to retention               |
| Receiving officer                          | Current receipts.manage capability and a delivery task for this request; selected task evidence only                                 | No deletion grant from receiving authority           |
| Demo creator/COO                           | Existing workspace ownership or COO selection authority; selected workspace evidence only                                            | No deletion grant from demo authority                |
| Plan viewer                                | Own department plus stock-requests.create, or requests.manage                                                                        | No new plan-deletion endpoint                        |
| Cross-institute actor                      | requests.cross-institute **and** target included in current institute_ids data scope; still requires parent action grant             | Same constraints plus delete capability/retention    |

A missing actor institute, unknown parent, orphan attachment, inconsistent request/item link, mixed parent where any parent fails, or ambiguous legacy contract provenance fails closed. Existing contract schemas lack a reliable numeric institute field; the policy requires explicit institute_id, source-request and end-user department ownership to agree where present. Creator provenance is used only when those business ownership links are absent; a cross-institute creator does not override explicit ownership. It does not infer or persist ownership. Records with absent/conflicting provenance require owner review; no guessed data backfill is performed.

Unknown/unauthorized files return the same generic 404 without filename, storage key, content or signed URL. Anonymous requests return 401. Internal authorization failures remain distinct from module/database availability errors. No-store is set on protected metadata/content and nosniff on bytes. UI visibility is supplementary, never an authorization decision.

The existing contract reviewer-role aliases and decision predicate are shared through `policies/contractApprovalPolicy.js` without changing their approval behavior. File authorization adds parent institute/department checks; no V2 or live-route logic changes.

## Access-path inventory and compatibility

| Path / caller                                                   | Disposition                                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public `/uploads/*`                                             | Public static serving removed. Same URL can be used with authentication, but only for a unique registered attachment/plan and an authorized parent. Unregistered files are never served.                                                                   |
| GET `/api/attachments/:id/download`                             | Authorize current parent then stream local/remote bytes.                                                                                                                                                                                                   |
| GET `/api/attachments/:requestId`, `/item/:itemId`              | Parent authorization plus per-file checks (including reviewer evidence filtering).                                                                                                                                                                         |
| POST request/item attachment endpoints                          | Authorize before storage; lock parent and recheck current authority/assignment after storage before metadata publication.                                                                                                                                  |
| GET `/api/attachments/download?path=...`, `/download/:filename` | Resolve a unique registered object; same canonical object checks. Ambiguous filename aliases return 404. They are not filesystem browsers.                                                                                                                 |
| GET `/api/files/:fileId`                                        | Compatible metadata endpoint returns canonical authenticated download URL. No broken storage aliases or presigned bearer URL.                                                                                                                              |
| DELETE `/api/files/:id`                                         | Delegates to canonical delete, including retention/audit and parent scope. Minimal acknowledgement; obsolete raw deleted_file payload is not returned.                                                                                                     |
| Contract attachment list/upload/delete                          | Delegates to the same handlers; contractId must match the attachment.                                                                                                                                                                                      |
| Contract document versions and extraction routes                | Shared parent authorization before existing metadata/AI handlers. External document links remain references; they do not grant arbitrary backend filesystem access.                                                                                        |
| Contract bulk deletion / request hard deletion                  | Parent scope and retained-file checks run before file references can be removed. This is not a general lifecycle refactor.                                                                                                                                 |
| Procurement plan upload/list/detail/download                    | Actual department/institute and action grant checked; local/remote download uses the common storage adapter. Legacy registered local paths resolve under the same policy. Forecast/replenishment mutations are outside this PR.                            |
| Request workspace embedded attachment metadata                  | Per-file parent authorization and canonical serialization before emitting metadata/timeline entries.                                                                                                                                                       |
| Technical review / demo / delivery evidence                     | Existing scoped parent workflows and immutable evidence references retained; generic download cannot bypass their assignments.                                                                                                                             |
| Surgical private files                                          | Shared current-actor gate delegates to the existing clinical case policy. Files stay in the existing private directory, outside uploads, with UUID-only storage names and realpath containment. No generic request permission grants clinical-file access. |
| Request creation/edit internal attachment persistence           | Existing authorized parent transaction supplies server-created request/item IDs; storage helper is internal, not an independent HTTP authority. Existing tests retained.                                                                                   |

Frontend changes are limited to affected file links: request/approval View actions, the maintenance approval attachment link and procurement-plan View now use authenticated Axios blob requests. Existing request/technical download handlers already use Axios and remain supported. Local serialized file_url now points to the authenticated canonical download route. No token is put in a query string or raw storage URL.

Existing anonymous bookmarks intentionally no longer work. Deploy the related backend/frontend changes together after review; no production deployment was performed here. Old external `/files` clients must fetch returned url with authentication instead of treating it as a presigned storage capability.

## Retention, races and recovery

Deletion is a database transaction: verify current authority, lock parent before attachment (matching approval lock ordering), reauthorize, check approval/technical/demo/contract evidence references, delete metadata and write a canonical audit event. Signed request approval evidence is append-only: after an approved/rejected nonsuperseded decision, upload a revision rather than deleting earlier files. This conservative rule also preserves request evidence when a parent hard-delete command is attempted.

SQL054's technical evidence FK remains the final arbiter for a concurrent new evidence reference; a retention conflict rolls back metadata deletion and never calls object deletion. A second delete serializes on the same parent/file and cannot remove the object twice. Upload authorization is repeated after slow storage; revoked relationships/permissions prevent metadata publication and the new uncommitted object is cleaned up.

Physical cleanup happens only after metadata/audit commit and only if no other attachment record references the key. The audit beforeData retains the prior metadata/storage reference. A cleanup failure leaves a private orphan and logs deferred cleanup; it does not roll back committed metadata or remove a retained file. Operator reconciliation should use that audit evidence and verify remaining references before removing an orphan. No cleanup job, external deployment or migration is introduced.

Download authorization is evaluated per request; bytes already delivered cannot be recalled. Existing previously issued external signed URLs remain subject to their original expiry/storage policy. New handlers mint no signed download URLs. Hosted bucket privacy, reverse-proxy static aliases and old signed URL revocation were not inspected or changed; operators must ensure nginx/CDN does not independently serve uploads outside the backend gate.

## Storage safety

`attachmentStorageAdapter` accepts registered keys, not frontend URLs or filesystem paths. It rejects absolute paths, URI schemes, backslashes, NULs, empty/dot/traversal components. Local paths must resolve under the real upload root; symlinks escaping that root fail. The final file opens with O_NOFOLLOW and must be a regular file. Legitimate literal percent/space names remain valid; client-side encoded traversal is not interpreted as an alternate namespace.

Remote keys use the configured backend storage adapter; credentials stay server-side. Remote redirects and content-disposition injection are not passed through. Streams abort on client close and have a timeout. A missing legacy local copy can use the existing remote fallback for the same registered key; a traversal/symlink denial cannot trigger that fallback. Private surgical files retain their separate storage/clinical ownership.

## Development verification

Use installed test dependencies. Jest setup overrides DATABASE_URL to loopback; endpoint databases and remote storage are mocked. Local tests create disposable temporary directories only. Do not point these commands at a hosted database or invoke migration installers.

```sh
cd purchase-backend
npm test -- --runInBand tests/attachmentAuthorization.test.js tests/attachmentEndpoints.test.js tests/attachmentStorageAdapter.test.js tests/attachmentRemoteStreaming.test.js tests/attachmentDownloadBoundary.test.js tests/surgicalConsignmentFiles.test.js tests/contractsAttachmentSchema.test.js tests/attachmentStorage.test.js tests/storage.test.js tests/saveRequestAttachments.test.js __tests__/attachmentPaths.test.js tests/contractApprovalWorkflow.test.js
npm test -- --runInBand
```

```sh
cd purchase-frontend
CI=true npm test -- --runInBand
npm run build
```

Targeted ESLint covers only the changed frontend files; full-repository lint/strict CI has the audit's existing unrelated findings. Test coverage includes anonymous/local aliases, unrelated same-institute/foreign users, requester/approver/buyer/technical grants, permission/assignment revocation, upload race cleanup, concurrent delete interleaving, approval/FK retention, legacy metadata/delete aliases, actual local streaming, remote proxy/no-redirect behavior, traversal/ambiguity and symlink escape. Mocked interleavings do not prove hosted PostgreSQL constraints or concurrency; no hosted compatibility certification is claimed.

The PR description records final counts and failures. Existing authorized workflows remain supported through their parent action grants and authenticated downloads; ambiguous ownership and obsolete anonymous file access deliberately fail closed.

## Verification results and exact changed files

- Full backend: `npm test -- --runInBand` — 212 suites: 209 passed, 3 failed; 1,648 tests passed, 3 failed (1,651 total). All new file-security suites pass. The failures are the unchanged audit-baseline SQL assertions in fetchRequestsController.domain/procurementHistoryController and reconciliation-fixture writes detected by phase5aCanonicalItemWriterBoundary. They were not suppressed.
- Focused file/compatibility run: 12 suites / 89 tests passed; later receiving-evidence and contract-approver/cross-scope tests also passed in the final full backend run.
- Full frontend: 100 suites: 99 passed, one unchanged DepartmentRequestedItemsBoard suite had two 5-second timeouts (451 passed / 2 failed of 453 tests). A focused rerun of that suite and the new authenticated file-client tests passed: 2 suites / 8 tests. No timeout thresholds or unrelated tests were modified.
- Targeted ESLint on all seven changed frontend files passed without warnings/errors.
- `CI=false npm run build` passed with the two existing application warnings (DepartmentRequestedItemsBoard unused actionLoading; PhysicalInventory effect dependency). Strict CI baseline warnings were not fixed or suppressed by source changes in this focused PR.
- Node syntax checks passed for all 21 changed/new backend JS files; `git diff --check` passed. No SQL files or dependency/lock files changed.

Exact changed files in this PR:

- `purchase-backend/app.js`
- `purchase-backend/controllers/attachmentsController.js`
- `purchase-backend/controllers/contractsController.js`
- `purchase-backend/controllers/filesController.js`
- `purchase-backend/controllers/procurement/plansController.js`
- `purchase-backend/controllers/requests/requestWorkspaceController.js`
- `purchase-backend/controllers/requests/updateRequestsController.js`
- `purchase-backend/docs/attachment-authorization.md`
- `purchase-backend/policies/contractApprovalPolicy.js`
- `purchase-backend/routes/attachments.js`
- `purchase-backend/routes/contracts.js`
- `purchase-backend/routes/surgicalConsignments.js`
- `purchase-backend/services/attachmentAuthorizationService.js`
- `purchase-backend/services/attachmentStorageAdapter.js`
- `purchase-backend/tests/attachmentAuthorization.test.js`
- `purchase-backend/tests/attachmentDownloadBoundary.test.js`
- `purchase-backend/tests/attachmentEndpoints.test.js`
- `purchase-backend/tests/attachmentRemoteStreaming.test.js`
- `purchase-backend/tests/attachmentStorageAdapter.test.js`
- `purchase-backend/tests/helpers/attachmentFixture.js`
- `purchase-backend/tests/surgicalConsignmentFiles.test.js`
- `purchase-backend/utils/attachmentPaths.js`
- `purchase-frontend/src/api/attachments.js`
- `purchase-frontend/src/api/attachments.test.js`
- `purchase-frontend/src/components/RequestAttachmentsSection.jsx`
- `purchase-frontend/src/components/approvals/ApprovalsWorkspace.jsx`
- `purchase-frontend/src/components/approvals/AttachmentsPanel.jsx`
- `purchase-frontend/src/pages/ApprovalsPanel.jsx`
- `purchase-frontend/src/pages/ProcurementPlansPage.jsx`

LIVE_ROUTING_ENABLED remains FALSE.
The existing approval engine remains authoritative.
No SQL was executed against Development Supabase.
No SQL was executed against Production Supabase.
