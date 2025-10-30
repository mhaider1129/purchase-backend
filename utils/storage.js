
const crypto = require('crypto');
const path = require('path');
const sanitize = require('sanitize-filename');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const DEFAULT_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'attachments';
const DEFAULT_PREFIX = process.env.SUPABASE_STORAGE_PREFIX || 'attachments';

function createStorageError(message, code) {
  const error = new Error(message);
  if (code) {
    error.code = code;
  }
  return error;
}

function isStorageConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

function ensureConfigured() {
  if (!SUPABASE_URL) {
    throw createStorageError('Supabase URL is not configured', 'SUPABASE_NOT_CONFIGURED');
  }

  if (!SUPABASE_KEY) {
    throw createStorageError(
      'Supabase service role key (or anon key) is not configured',
      'SUPABASE_NOT_CONFIGURED'
    );
  }
}

function sanitizeSegment(segment) {
  const sanitized = sanitize(String(segment || '').replace(/\s+/g, '_'));
  return sanitized || 'segment';
}

function buildObjectKey(originalName, { segments = [], prefix } = {}) {
  const ext = path.extname(originalName || '').toLowerCase();
  const baseNameRaw = ext
    ? (originalName || '').slice(0, -ext.length)
    : originalName || 'file';
  const sanitizedBase = sanitize(baseNameRaw.replace(/\s+/g, '_').toLowerCase()) || 'file';
  const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const fileName = `${uniqueSuffix}-${sanitizedBase}${ext}`;

  const parts = [];

  const prefixValue = prefix || DEFAULT_PREFIX;
  if (prefixValue) {
    prefixValue
      .split('/')
      .map(part => part.trim())
      .filter(Boolean)
      .forEach(part => parts.push(sanitizeSegment(part)));
  }

  segments
    .map(segment => sanitizeSegment(segment))
    .filter(Boolean)
    .forEach(segment => parts.push(segment));

  parts.push(fileName);

  return parts.join('/');
}

function encodeObjectKey(objectKey) {
  return objectKey
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
}

async function uploadBuffer({ file, bucket = DEFAULT_BUCKET, segments = [], prefix } = {}) {
  ensureConfigured();

  if (!file || !file.buffer || file.buffer.length === 0) {
    throw createStorageError('Uploaded file is empty', 'SUPABASE_EMPTY_FILE');
  }

  const objectKey = buildObjectKey(file.originalname || 'file', { segments, prefix });
  const encodedBucket = encodeURIComponent(bucket);
  const encodedKey = encodeObjectKey(objectKey);
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${encodedBucket}/${encodedKey}`;

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': file.mimetype || 'application/octet-stream',
      'x-upsert': 'false',
      'cache-control': 'max-age=31536000, immutable',
    },
    body: file.buffer,
  });

  if (!response.ok) {
    let errorText = '';
    try {
      errorText = await response.text();
    } catch (err) {
      errorText = response.statusText;
    }
    throw createStorageError(
      `Supabase upload failed (${response.status}): ${errorText || response.statusText}`,
      'SUPABASE_UPLOAD_FAILED'
    );
  }

  return { objectKey, bucket };
}

async function createSignedUrl(objectKey, { bucket = DEFAULT_BUCKET, expiresIn = 60 } = {}) {
  ensureConfigured();

  if (!objectKey) {
    throw createStorageError('Missing storage object key', 'SUPABASE_MISSING_OBJECT');
  }

  const encodedBucket = encodeURIComponent(bucket);
  const encodedKey = encodeObjectKey(objectKey);
  const signUrl = `${SUPABASE_URL}/storage/v1/object/sign/${encodedBucket}/${encodedKey}`;

  const response = await fetch(signUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn }),
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch (err) {
    payload = {};
  }

  if (!response.ok || !payload?.signedURL) {
    const message = payload?.error || payload?.message || response.statusText;
    throw createStorageError(`Failed to create signed URL: ${message}`, 'SUPABASE_SIGN_FAILED');
  }

  const signedPath = payload.signedURL;
  return signedPath.startsWith('http')
    ? signedPath
    : `${SUPABASE_URL}${signedPath}`;
}

async function removeObject(objectKey, { bucket = DEFAULT_BUCKET } = {}) {
  ensureConfigured();

  if (!objectKey) {
    return;
  }

  const encodedBucket = encodeURIComponent(bucket);
  const encodedKey = encodeObjectKey(objectKey);
  const deleteUrl = `${SUPABASE_URL}/storage/v1/object/${encodedBucket}/${encodedKey}`;

  const response = await fetch(deleteUrl, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });

  if (!response.ok && response.status !== 404) {
    let errorText = '';
    try {
      errorText = await response.text();
    } catch (err) {
      errorText = response.statusText;
    }
    throw createStorageError(
      `Failed to delete object from storage: ${errorText || response.statusText}`,
      'SUPABASE_DELETE_FAILED'
    );
  }
}

module.exports = {
  uploadBuffer,
  createSignedUrl,
  removeObject,
  buildObjectKey,
  isStorageConfigured,
  DEFAULT_BUCKET,
  DEFAULT_PREFIX,
};