const crypto = require('crypto');

const requestMetrics = {
  total: 0,
  errors: 0,
  byMethod: {},
  byStatus: {},
  durationsMs: {
    count: 0,
    sum: 0,
    max: 0,
  },
};

const SERVICE_START = Date.now();

const toFixedNumber = (value, digits = 2) => Number.parseFloat(value.toFixed(digits));

const log = (level, message, extra = {}) => {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...extra,
  };

  const line = JSON.stringify(payload);

  if (level === 'error' || level === 'warn') {
    console.error(line);
    return;
  }

  console.log(line);
};

const requestIdFromHeader = headerValue => {
  if (!headerValue) {
    return null;
  }

  const normalized = String(headerValue).trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 128);
};

const createRequestId = () => {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return crypto.randomBytes(16).toString('hex');
};

const recordRequestMetric = ({ method, statusCode, durationMs }) => {
  requestMetrics.total += 1;
  requestMetrics.byMethod[method] = (requestMetrics.byMethod[method] || 0) + 1;
  requestMetrics.byStatus[statusCode] = (requestMetrics.byStatus[statusCode] || 0) + 1;

  if (statusCode >= 500) {
    requestMetrics.errors += 1;
  }

  requestMetrics.durationsMs.count += 1;
  requestMetrics.durationsMs.sum += durationMs;
  requestMetrics.durationsMs.max = Math.max(requestMetrics.durationsMs.max, durationMs);
};

const requestTracingMiddleware = (req, res, next) => {
  const incomingRequestId = requestIdFromHeader(req.header('x-request-id'));
  const requestId = incomingRequestId || createRequestId();
  const start = process.hrtime.bigint();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  res.on('finish', () => {
    const elapsedNs = process.hrtime.bigint() - start;
    const durationMs = Number(elapsedNs) / 1_000_000;

    recordRequestMetric({
      method: req.method,
      statusCode: res.statusCode,
      durationMs,
    });

    const logLevel = res.statusCode >= 500 ? 'error' : 'info';

    log(logLevel, 'http_request_completed', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: toFixedNumber(durationMs),
      userAgent: req.get('user-agent') || null,
      ip: req.ip,
    });
  });

  next();
};

const getErrorBudgetSummary = () => {
  const total = requestMetrics.total;
  const errors = requestMetrics.errors;
  const targetAvailability = Number.parseFloat(process.env.ERROR_BUDGET_SLO || '99.9');
  const allowedFailureRatio = Math.max(0, 1 - targetAvailability / 100);
  const currentFailureRatio = total > 0 ? errors / total : 0;
  const currentAvailability = (1 - currentFailureRatio) * 100;

  const budgetConsumedPercent = allowedFailureRatio > 0
    ? (currentFailureRatio / allowedFailureRatio) * 100
    : (errors > 0 ? 100 : 0);

  return {
    targetAvailabilityPercent: targetAvailability,
    currentAvailabilityPercent: toFixedNumber(Math.max(0, currentAvailability), 4),
    requestsTotal: total,
    errorsTotal: errors,
    budgetConsumedPercent: toFixedNumber(Math.max(0, budgetConsumedPercent), 2),
    budgetRemainingPercent: toFixedNumber(Math.max(0, 100 - budgetConsumedPercent), 2),
    breached: budgetConsumedPercent > 100,
  };
};

const metricsText = () => {
  const uptimeSeconds = (Date.now() - SERVICE_START) / 1000;
  const averageDuration = requestMetrics.durationsMs.count > 0
    ? requestMetrics.durationsMs.sum / requestMetrics.durationsMs.count
    : 0;

  return [
    '# HELP service_uptime_seconds Process uptime in seconds.',
    '# TYPE service_uptime_seconds gauge',
    `service_uptime_seconds ${toFixedNumber(uptimeSeconds, 3)}`,
    '# HELP http_requests_total Total HTTP requests handled.',
    '# TYPE http_requests_total counter',
    `http_requests_total ${requestMetrics.total}`,
    '# HELP http_request_errors_total Total HTTP 5xx responses.',
    '# TYPE http_request_errors_total counter',
    `http_request_errors_total ${requestMetrics.errors}`,
    '# HELP http_request_duration_average_ms Average request duration in milliseconds.',
    '# TYPE http_request_duration_average_ms gauge',
    `http_request_duration_average_ms ${toFixedNumber(averageDuration, 3)}`,
    '# HELP http_request_duration_max_ms Maximum request duration in milliseconds.',
    '# TYPE http_request_duration_max_ms gauge',
    `http_request_duration_max_ms ${toFixedNumber(requestMetrics.durationsMs.max, 3)}`,
  ].join('\n');
};

const metricsHandler = (req, res) => {
  res.type('text/plain');
  res.send(metricsText());
};

const errorBudgetHandler = (req, res) => {
  res.status(200).json({
    success: true,
    errorBudget: getErrorBudgetSummary(),
  });
};

module.exports = {
  log,
  requestTracingMiddleware,
  metricsHandler,
  errorBudgetHandler,
  getErrorBudgetSummary,
};