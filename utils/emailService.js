const nodemailer = require('nodemailer');
require('dotenv').config();

let transporter = null;

const hasEmailCredentials = process.env.EMAIL_HOST && process.env.EMAIL_USER;

if (hasEmailCredentials) {
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT, 10) || 587,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
} else {
  console.warn('🚨 Email credentials not fully configured; emails will not be sent');
}

const EMAIL_FROM = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'no-reply@localhost';

const normalizeRecipients = recipients => {
  if (!recipients) return [];

  const list = Array.isArray(recipients)
    ? recipients
    : String(recipients)
        .split(',')
        .map(value => value.trim());

  return list
    .map(value => (value == null ? '' : String(value).trim()))
    .filter(Boolean);
};

const escapeHtml = value =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const convertTextToHtml = text =>
  text
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
        if (entry[key] === undefined) {
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

const sendEmail = async (to, subject, message, options = {}) => {
  const recipients = normalizeRecipients(to);

  if (recipients.length === 0) {
    console.warn('⚠️ sendEmail called without any recipients', { subject });
    return null;
  }

  const {
    cc,
    bcc,
    replyTo,
    headers,
    attachments,
    documentation,
    html,
    text,
    enableHtml = true,
    convertLineBreaks = true,
  } = options;

  const normalizedCc = normalizeRecipients(cc);
  const normalizedBcc = normalizeRecipients(bcc);

  const payload = {
    from: EMAIL_FROM,
    to: recipients,
    subject: subject ? String(subject).trim() : undefined,
    cc: normalizedCc.length > 0 ? normalizedCc : undefined,
    bcc: normalizedBcc.length > 0 ? normalizedBcc : undefined,
    replyTo: replyTo ? String(replyTo).trim() : undefined,
    headers,
  };

  const messageText = typeof text === 'string' ? text : typeof message === 'string' ? message : undefined;
  if (messageText) {
    payload.text = messageText;
  }

  let htmlBody;
  if (typeof html === 'string') {
    htmlBody = html;
  } else if (enableHtml && typeof messageText === 'string') {
    htmlBody = convertLineBreaks ? convertTextToHtml(messageText) : messageText;
  }

  if (htmlBody) {
    payload.html = htmlBody;
  }

  const normalizedAttachments = Array.isArray(attachments)
    ? attachments.filter(Boolean).map(attachment => ({ ...attachment }))
    : [];

  const documentationAttachments = normalizeDocumentation(documentation);

  const hasAttachments = normalizedAttachments.length > 0 || documentationAttachments.length > 0;

  if (hasAttachments) {
    payload.attachments = [...normalizedAttachments, ...documentationAttachments];
  }

  Object.keys(payload).forEach(key => {
    if (payload[key] === undefined) {
      delete payload[key];
    }
  });

  if (!transporter) {
    console.info('📨 Email skipped (transporter not configured)', {
      to: recipients,
      subject: payload.subject,
    });
    return null;
  }

  try {
    const info = await transporter.sendMail(payload);
    const accepted = Array.isArray(info?.accepted) && info.accepted.length > 0 ? info.accepted : recipients;
    console.log(`📧 Email sent to ${accepted.join(', ')}`);
    return info;
  } catch (err) {
    console.error('❌ Failed to send email:', err);
    return null;
  }
};

module.exports = {
  sendEmail,
  _private: {
    normalizeRecipients,
    convertTextToHtml,
    normalizeDocumentation,
  },
};