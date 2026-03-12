const pool = require('../config/db');
const { WRITE_METHODS, resolveCapability } = require('../config/capabilityMatrix');

const SENSITIVE_KEYS = ['password', 'token', 'secret', 'authorization', 'apiKey', 'accessKey'];
let auditTableReadyPromise;

const ensureAuditTable = async () => {
  if (!auditTableReadyPromise) {
    auditTableReadyPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS governance_audit_trail (
        id BIGSERIAL PRIMARY KEY,
        actor_id INTEGER,
        actor_role TEXT,
        request_path TEXT NOT NULL,
        method TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        module TEXT NOT NULL,
        resource TEXT NOT NULL,
        action TEXT NOT NULL,
        required_permissions TEXT[] NOT NULL DEFAULT '{}',
        request_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  return auditTableReadyPromise;
};

const redactPayload = (value) => {
  if (Array.isArray(value)) {
    return value.map(redactPayload);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    const lowered = key.toLowerCase();
    const shouldRedact = SENSITIVE_KEYS.some((candidate) => lowered.includes(candidate.toLowerCase()));
    output[key] = shouldRedact ? '[REDACTED]' : redactPayload(nested);
  }

  return output;
};

const writeAuditTrail = (req, res, next) => {
  if (!WRITE_METHODS.has(req.method)) {
    next();
    return;
  }

  res.on('finish', async () => {
    if (res.statusCode >= 500) {
      return;
    }

    try {
      await ensureAuditTable();

      const capability = resolveCapability(req.originalUrl, req.method);
      const actorId = Number.isInteger(req.user?.id) ? req.user.id : null;
      const actorRole = req.user?.role || null;
      const requestPath = req.originalUrl?.split('?')[0] || req.path || '';
      const requestId = req.headers['x-request-id'] || null;
      const userAgent = req.headers['user-agent'] || null;
      const payload = redactPayload(req.body || {});

      await pool.query(
        `INSERT INTO governance_audit_trail (
          actor_id,
          actor_role,
          request_path,
          method,
          status_code,
          module,
          resource,
          action,
          required_permissions,
          request_id,
          ip_address,
          user_agent,
          payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::TEXT[], $10, $11, $12, $13::JSONB)`,
        [
          actorId,
          actorRole,
          requestPath,
          req.method,
          res.statusCode,
          capability.module,
          capability.resource,
          capability.action,
          capability.permissions,
          requestId,
          req.ip,
          userAgent,
          JSON.stringify(payload),
        ]
      );
    } catch (error) {
      console.warn('⚠️ Failed to persist governance audit trail entry:', error.message || error);
    }
  });

  next();
};

module.exports = {
  writeAuditTrail,
  ensureAuditTable,
};