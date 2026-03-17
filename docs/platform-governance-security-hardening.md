# Platform Governance & Security Hardening

## 1) Capability Matrix Standard

The backend now maintains a centralized capability matrix in `config/capabilityMatrix.js`.

Each capability definition explicitly maps:

- `module` (domain boundary)
- `resource` (logical managed asset)
- `action` (`read` vs `write`, resolved from HTTP method)
- `permissions` (permission codes expected for those routes)

This matrix is used by governance audit instrumentation to classify write operations consistently.

## 2) Audit Trail Enforcement for Write Operations

All write operations under `/api/*` now pass through `middleware/writeAuditTrail.js`.

The middleware records governance audit rows in `governance_audit_trail` with:

- actor context (`actor_id`, `actor_role`)
- request context (`request_path`, `method`, `status_code`, `request_id`, `ip_address`, `user_agent`)
- capability context (`module`, `resource`, `action`, `required_permissions`)
- sanitized payload (`payload`) with secrets redacted

### Scope

This includes administrative write operations (for example routes under `/api/admin-tools`, `/api/permissions`, `/api/roles`, `/api/ui-access`) and other business write APIs.

## 3) Environment-Based Configuration Strategy

Environment policy is centralized in `config/environment.js`.

- `loadEnvironmentConfig()` validates profile-specific required variables by environment.
- Missing required variables fail fast during startup.
- Missing recommended variables produce startup warnings.
- Runtime metadata is normalized in one object (`nodeEnv`, `appConfigVersion`, secret-rotation metadata).

### Profiles

- `development`
- `test`
- `production`

Each profile inherits baseline required variables and can extend required/recommended keys.

## 4) Secrets Rotation Runbook

Use this runbook for production credential/material rotation (JWT, DB credentials, API keys, SMTP credentials).

1. **Plan window**
   - Define maintenance window and rollback owner.
   - Confirm incident channel and on-call assignments.
2. **Inventory secrets**
   - Identify all active secrets and consuming services.
   - Record expected post-rotation `APP_CONFIG_VERSION`.
3. **Generate new material**
   - Create new values in the secret manager.
   - Do not overwrite old values until verification completes.
4. **Staged deployment**
   - Deploy new secret references to non-production first.
   - Validate authentication, DB connectivity, and outbound integrations.
5. **Production rollout**
   - Deploy updated environment variables.
   - Set/advance:
     - `APP_CONFIG_VERSION`
     - `SECRET_ROTATION_LAST_COMPLETED_AT`
     - `SECRET_ROTATION_INTERVAL_DAYS`
6. **Verification**
   - Confirm `/health` endpoint and core user flows.
   - Confirm write operations are still present in `governance_audit_trail`.
7. **Retire old secrets**
   - Revoke superseded credentials after successful validation.
8. **Post-rotation review**
   - Log completion timestamp and follow-up tasks.
   - Archive evidence in the security operations repository.

## 5) Operational Notes

- Keep the capability matrix current when adding/changing API route namespaces.
- Treat drift between route permissions and matrix permissions as a governance defect.
- Audit-trail table creation is automatic on first write request.