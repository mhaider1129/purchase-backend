const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();

const DEFAULT_APP_URL = 'https://wici-procurement.org';
const DEFAULT_RETRY_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 500;

let transporter = null;

const parseBoolean = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const parseInteger = (value, defaultValue) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

const EMAIL_FROM = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'no-reply@localhost';
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || undefined;
const EMAIL_DRY_RUN = parseBoolean(process.env.EMAIL_DRY_RUN, false);
const EMAIL_APP_URL = (process.env.FRONTEND_URL || process.env.APP_PUBLIC_URL || process.env.APP_URL || DEFAULT_APP_URL).replace(/\/$/, '');
const EMAIL_RETRY_ATTEMPTS = Math.max(1, parseInteger(process.env.EMAIL_RETRY_ATTEMPTS, DEFAULT_RETRY_ATTEMPTS));
const EMAIL_RETRY_DELAY_MS = Math.max(0, parseInteger(process.env.EMAIL_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS));

const hasEmailHost = Boolean(process.env.EMAIL_HOST || process.env.EMAIL_SERVICE);
const hasEmailCredentials = Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);

const buildTransportConfig = () => {
  if (!hasEmailHost) return null;

  const config = process.env.EMAIL_SERVICE
    ? { service: process.env.EMAIL_SERVICE }
    : {
        host: process.env.EMAIL_HOST,
        port: parseInteger(process.env.EMAIL_PORT, 587),
        secure: parseBoolean(process.env.EMAIL_SECURE, parseInteger(process.env.EMAIL_PORT, 587) === 465),
      };

  if (hasEmailCredentials) {
    config.auth = {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    };
  }

  if (process.env.EMAIL_POOL) config.pool = parseBoolean(process.env.EMAIL_POOL);
  if (process.env.EMAIL_MAX_CONNECTIONS) config.maxConnections = parseInteger(process.env.EMAIL_MAX_CONNECTIONS, 5);
  if (process.env.EMAIL_MAX_MESSAGES) config.maxMessages = parseInteger(process.env.EMAIL_MAX_MESSAGES, 100);
  if (process.env.EMAIL_REQUIRE_TLS) config.requireTLS = parseBoolean(process.env.EMAIL_REQUIRE_TLS);
  if (process.env.EMAIL_IGNORE_TLS) config.ignoreTLS = parseBoolean(process.env.EMAIL_IGNORE_TLS);
  if (process.env.EMAIL_TLS_REJECT_UNAUTHORIZED) {
    config.tls = { rejectUnauthorized: parseBoolean(process.env.EMAIL_TLS_REJECT_UNAUTHORIZED, true) };
  }

  return config;
};

const transportConfig = buildTransportConfig();

if (transportConfig && !EMAIL_DRY_RUN) {
  transporter = nodemailer.createTransport(transportConfig);
} else if (EMAIL_DRY_RUN) {
  console.warn('🚨 Email dry-run mode enabled; emails will be rendered but not sent');
} else {
  console.warn('🚨 Email transport not configured; emails will not be sent');
}

const normalizeRecipients = recipients => {
  if (!recipients) return [];

  const list = Array.isArray(recipients)
    ? recipients
    : String(recipients)
        .split(/[;,]/)
        .map(value => value.trim());

  return [...new Set(list.map(value => (value == null ? '' : String(value).trim())).filter(Boolean))];
};

const escapeHtml = value =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const convertTextToHtml = text =>
  String(text ?? '')
    .split(/\r?\n/)
    .map(line => {
      if (!line.trim()) {
        return '<p style="margin: 0 0 12px;">&nbsp;</p>';
      }
      return `<p style="margin: 0 0 12px;">${escapeHtml(line)}</p>`;
    })
    .join('\n');

const toArray = value => {
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return [];
  }
  return [value];
};

const normalizeDocumentation = documentation => {
  const docs = toArray(documentation);
  const normalized = [];
  let autoNameCounter = 1;

  for (const doc of docs) {
    if (!doc) continue;

    if (typeof doc === 'string') {
      const trimmed = doc.trim();
      if (trimmed) {
        normalized.push({ path: trimmed });
      }
      continue;
    }

    if (Buffer.isBuffer(doc)) {
      normalized.push({ filename: `documentation-${autoNameCounter++}`, content: doc });
      continue;
    }

    if (typeof doc === 'object') {
      const entry = { ...doc };

      Object.keys(entry).forEach(key => {
        if (entry[key] === undefined || entry[key] === null || entry[key] === '') {
          delete entry[key];
        }
      });

      if (Object.keys(entry).length === 0) {
        continue;
      }

      if (Buffer.isBuffer(entry.content) && !entry.filename) {
        entry.filename = `documentation-${autoNameCounter++}`;
      }

      normalized.push(entry);
    }
  }

  return normalized;
};

const getEmailFooter = () => {
  const text = `\n\n--\nFor more details, please visit the Procurement System at ${EMAIL_APP_URL}`;
  const html = `<br><br><hr><p>For more details, please visit the <a href="${escapeHtml(EMAIL_APP_URL)}">Procurement System</a>.</p>`;
  return { text, html };
};

const wrapHtmlLayout = ({ subject, body, preheader }) => {
  const safeSubject = escapeHtml(subject || 'Procurement System Notification');
  const safePreheader = escapeHtml(preheader || subject || 'Procurement System update');
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${safeSubject}</title></head>
  <body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#17202a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${safePreheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:24px 0;"><tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="background:#0f766e;color:#ffffff;padding:20px 24px;font-size:20px;font-weight:700;">${safeSubject}</td></tr>
        <tr><td style="padding:24px;font-size:15px;line-height:1.55;">${body}</td></tr>
      </table>
    </td></tr></table>
  </body>
</html>`;
};

const renderTemplate = (template, data = {}) => {
  if (!template) return '';
  return String(template).replace(/{{\s*([\w.]+)\s*}}/g, (_match, key) => {
    const value = key.split('.').reduce((current, part) => (current == null ? undefined : current[part]), data);
    return value == null ? '' : String(value);
  });
};

const buildEmailPayload = (to, subject, message, options = {}) => {
  const recipients = normalizeRecipients(to);
  const {
    cc,
    bcc,
    replyTo = EMAIL_REPLY_TO,
    headers,
    attachments,
    documentation,
    html,
    text,
    template,
    templateData,
    preheader,
    enableHtml = true,
    convertLineBreaks = true,
    layout = true,
  } = options;

  const normalizedCc = normalizeRecipients(cc);
  const normalizedBcc = normalizeRecipients(bcc);
  const renderedMessage = template ? renderTemplate(template, templateData) : message;
  const messageText = typeof text === 'string' ? text : typeof renderedMessage === 'string' ? renderedMessage : undefined;
  const footer = getEmailFooter();

  const payload = {
    from: EMAIL_FROM,
    to: recipients,
    subject: subject ? String(subject).trim() : 'Procurement System Notification',
    cc: normalizedCc.length > 0 ? normalizedCc : undefined,
    bcc: normalizedBcc.length > 0 ? normalizedBcc : undefined,
    replyTo: replyTo ? String(replyTo).trim() : undefined,
    headers,
  };

  if (messageText) payload.text = messageText + footer.text;

  let htmlBody;
  if (typeof html === 'string') {
    htmlBody = renderTemplate(html, templateData);
  } else if (enableHtml && typeof messageText === 'string') {
    htmlBody = convertLineBreaks ? convertTextToHtml(messageText) : messageText;
  }

  if (htmlBody) {
    const bodyWithFooter = htmlBody + footer.html;
    payload.html = layout ? wrapHtmlLayout({ subject: payload.subject, body: bodyWithFooter, preheader }) : bodyWithFooter;
  }

  const normalizedAttachments = Array.isArray(attachments)
    ? attachments.filter(Boolean).map(attachment => ({ ...attachment }))
    : [];
  const documentationAttachments = normalizeDocumentation(documentation);

  if (normalizedAttachments.length > 0 || documentationAttachments.length > 0) {
    payload.attachments = [...normalizedAttachments, ...documentationAttachments];
  }

  Object.keys(payload).forEach(key => {
    if (payload[key] === undefined || (Array.isArray(payload[key]) && payload[key].length === 0)) delete payload[key];
  });

  return payload;
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const sendWithRetry = async payload => {
  let lastError;
  for (let attempt = 1; attempt <= EMAIL_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await transporter.sendMail(payload);
    } catch (err) {
      lastError = err;
      if (attempt < EMAIL_RETRY_ATTEMPTS) {
        console.warn(`⚠️ Email send attempt ${attempt} failed; retrying`, err?.message || err);
        await sleep(EMAIL_RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastError;
};

const EMAIL_ACTION_SECRET = process.env.EMAIL_ACTION_SECRET || process.env.JWT_SECRET || 'email-action-secret';
const EMAIL_ACTION_TTL_SECONDS = Number.parseInt(process.env.EMAIL_ACTION_TTL_SECONDS || '172800', 10);

const createApprovalActionToken = ({ approvalId, action, approverId }) => {
  const exp = Math.floor(Date.now() / 1000) + EMAIL_ACTION_TTL_SECONDS;
  const payload = `${approvalId}:${action}:${approverId}:${exp}`;
  const signature = crypto.createHmac('sha256', EMAIL_ACTION_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${signature}`).toString('base64url');
};

const verifyApprovalActionToken = token => {
  try {
    const decoded = Buffer.from(String(token), 'base64url').toString('utf8');
    const [approvalId, action, approverId, exp, signature] = decoded.split(':');
    if (!approvalId || !action || !approverId || !exp || !signature) return null;
    if (!['Approved', 'Rejected'].includes(action)) return null;
    const payload = `${approvalId}:${action}:${approverId}:${exp}`;
    const expected = crypto.createHmac('sha256', EMAIL_ACTION_SECRET).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
    if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
    return { approvalId: Number(approvalId), action, approverId: Number(approverId) };
  } catch (_err) {
    return null;
  }
};

const buildApprovalActionLinks = ({ approvalId, approverId }) => {
  const backendBase = (process.env.BACKEND_URL || process.env.APP_URL || 'http://localhost:5000').replace(/\/$/, '');
  const approvedToken = createApprovalActionToken({ approvalId, action: 'Approved', approverId });
  const rejectedToken = createApprovalActionToken({ approvalId, action: 'Rejected', approverId });
  return {
    approveUrl: `${backendBase}/api/approvals/email-action?token=${approvedToken}`,
    rejectUrl: `${backendBase}/api/approvals/email-action?token=${rejectedToken}`,
  };
};

const sendEmail = async (to, subject, message, options = {}) => {
  const payload = buildEmailPayload(to, subject, message, options);

  if (!payload.to || payload.to.length === 0) {
    console.warn('⚠️ sendEmail called without any recipients', { subject });
    return null;
  }

  if (EMAIL_DRY_RUN) {
    console.info('📨 Email dry-run payload', { to: payload.to, subject: payload.subject });
    return { dryRun: true, envelope: { to: payload.to }, message: payload };
  }

  if (!transporter) {
    console.info('📨 Email skipped (transporter not configured)', {
      to: payload.to,
      subject: payload.subject,
    });
    return null;
  }

  try {
    const info = await sendWithRetry(payload);
    const accepted = Array.isArray(info?.accepted) && info.accepted.length > 0 ? info.accepted : payload.to;
    console.log(`📧 Email sent to ${accepted.join(', ')}`);
    return info;
  } catch (err) {
    console.error('❌ Failed to send email:', err);
    if (options.throwOnError) throw err;
    return null;
  }
};

const verifyEmailTransport = async () => {
  if (!transporter) return { ok: false, reason: EMAIL_DRY_RUN ? 'dry-run-enabled' : 'not-configured' };
  try {
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || 'verification-failed' };
  }
};

module.exports = {
  sendEmail,
  buildApprovalActionLinks,
  verifyApprovalActionToken,
  verifyEmailTransport,
  _private: {
    normalizeRecipients,
    convertTextToHtml,
    normalizeDocumentation,
    getEmailFooter,
    buildApprovalActionLinks,
    verifyApprovalActionToken,
    buildEmailPayload,
    renderTemplate,
    wrapHtmlLayout,
    buildTransportConfig,
    parseBoolean,
  },
};