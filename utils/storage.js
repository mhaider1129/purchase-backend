const crypto = require('crypto');
const path = require('path');
const sanitize = require('sanitize-filename');

const bucketInitializationState = new Map();

function getStorageConfiguration() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'attachments';
  const prefix = process.env.SUPABASE_STORAGE_PREFIX || 'attachments';

  return { url, key, bucket, prefix };
}

function createStorageError(message, code) {
  const error = new Error(message);
  if (code) {
    error.code = code;
  }
  return error;
}

function isStorageConfigured() {
  const { url, key } = getStorageConfiguration();
  return Boolean(url && key);
}

function ensureConfigured(config = getStorageConfiguration()) {
  const { url, key } = config;

  if (!url) {
    throw createStorageError('Supabase URL is not configured', 'SUPABASE_NOT_CONFIGURED');
  }

  if (!key) {
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

function buildAuthHeaders(config, additional = {}) {
  const headers = {
    Authorization: `Bearer ${config.key}`,
    apikey: config.key,
    ...additional,
  };

  return headers;
}

async function readResponseBody(response) {
  if (!response || typeof response.text !== 'function') {
    return '';
  }

  try {
    return await response.text();
  } catch (err) {
    return response?.statusText || '';
  }
}

function normalizeStatusCode(status, detail) {
  if (detail) {
    try {
      const parsed = JSON.parse(detail);
      const candidate = parsed?.statusCode ?? parsed?.status ?? parsed?.code;
      if (typeof candidate === 'number' && !Number.isNaN(candidate)) {
        return candidate;
      }
      if (typeof candidate === 'string') {
        const numeric = parseInt(candidate, 10);
        if (!Number.isNaN(numeric)) {
          return numeric;
        }
      }
    } catch (err) {
      // ignore JSON parsing issues and fall through to string inspection
    }

    const lowerDetail = detail.toLowerCase();
    if (lowerDetail.includes('bucket not found')) {
      return 404;
    }
  }

  if (typeof status === 'number' && !Number.isNaN(status)) {
    return status;
  }

  if (typeof status === 'string') {
    const numeric = parseInt(status, 10);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }
  }

  return undefined;
}

async function ensureBucketExists(bucket, config = getStorageConfiguration()) {
  if (!bucket) {
    throw createStorageError(
      'Supabase storage bucket name is not configured',
      'SUPABASE_BUCKET_INVALID'
    );
  }

  const state = bucketInitializationState.get(bucket);
  if (state === true) {
    return;
  }

  if (state instanceof Promise) {
    return state;
  }

  const ensurePromise = (async () => {
    const bucketStatusUrl = `${config.url}/storage/v1/bucket/${encodeURIComponent(bucket)}`;
    const statusResponse = await fetch(bucketStatusUrl, {
      method: 'GET',
      headers: buildAuthHeaders(config),
    });

    if (statusResponse.ok) {
      bucketInitializationState.set(bucket, true);
      return;
    }

    const detail = await readResponseBody(statusResponse);
    const statusCode = normalizeStatusCode(statusResponse.status, detail);

    if (statusCode !== 404) {
      throw createStorageError(
        `Failed to verify Supabase storage bucket "${bucket}": ${detail || statusResponse.statusText}`,
        'SUPABASE_BUCKET_STATUS_FAILED'
      );
    }

    const createResponse = await fetch(`${config.url}/storage/v1/bucket`, {
      method: 'POST',
      headers: buildAuthHeaders(config, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: bucket, public: false }),
    });

    const createStatus =
      typeof createResponse.status === 'number'
        ? createResponse.status
        : parseInt(createResponse.status, 10);

    if (!createResponse.ok && createStatus !== 409) {
      const detail = await readResponseBody(createResponse);
      throw createStorageError(
        `Failed to create Supabase storage bucket "${bucket}": ${detail || createResponse.statusText}`,
        'SUPABASE_BUCKET_CREATE_FAILED'
      );
    }

    bucketInitializationState.set(bucket, true);
  })();

  bucketInitializationState.set(bucket, ensurePromise);

  try {
    await ensurePromise;
  } catch (err) {
    bucketInitializationState.delete(bucket);
    throw err;
  }
}

function buildObjectKey(originalName, { segments = [], prefix } = {}) {
  const { prefix: defaultPrefix } = getStorageConfiguration();
  const ext = path.extname(originalName || '').toLowerCase();
  const baseNameRaw = ext
    ? (originalName || '').slice(0, -ext.length)
    : originalName || 'file';
  const sanitizedBase = sanitize(baseNameRaw.replace(/\s+/g, '_').toLowerCase()) || 'file';
  const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const fileName = `${uniqueSuffix}-${sanitizedBase}${ext}`;

  const parts = [];

  const prefixValue = prefix ?? defaultPrefix;
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

async function uploadBuffer({ file, bucket, segments = [], prefix } = {}) {
  const config = getStorageConfiguration();
  ensureConfigured(config);

  if (!file || !file.buffer || file.buffer.length === 0) {
    throw createStorageError('Uploaded file is empty', 'SUPABASE_EMPTY_FILE');
  }

  const targetBucket = bucket ?? config.bucket;
  const effectivePrefix = prefix ?? config.prefix;

  await ensureBucketExists(targetBucket, config);

  const objectKey = buildObjectKey(file.originalname || 'file', { segments, prefix: effectivePrefix });
  const encodedBucket = encodeURIComponent(targetBucket);
  const encodedKey = encodeObjectKey(objectKey);
  const uploadUrl = `${config.url}/storage/v1/object/${encodedBucket}/${encodedKey}`;

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: buildAuthHeaders(config, {
      'Content-Type': file.mimetype || 'application/octet-stream',
      'x-upsert': 'false',
      'cache-control': 'max-age=31536000, immutable',
    }),
    body: file.buffer,
  });

  if (!response.ok) {
    const errorText = await readResponseBody(response);
    throw createStorageError(
      `Supabase upload failed (${response.status}): ${errorText || response.statusText}`,
      'SUPABASE_UPLOAD_FAILED'
    );
  }

  return { objectKey, bucket: targetBucket };
}

async function createSignedUrl(objectKey, { bucket, expiresIn = 60 } = {}) {
  const config = getStorageConfiguration();
  ensureConfigured(config);

  if (!objectKey) {
    throw createStorageError('Missing storage object key', 'SUPABASE_MISSING_OBJECT');
  }

  const targetBucket = bucket ?? config.bucket;
  const encodedBucket = encodeURIComponent(targetBucket);
  const encodedKey = encodeObjectKey(objectKey);
  const signUrl = `${config.url}/storage/v1/object/sign/${encodedBucket}/${encodedKey}`;

  const response = await fetch(signUrl, {
    method: 'POST',
    headers: buildAuthHeaders(config, {
      'Content-Type': 'application/json',
    }),
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
    : `${config.url}${signedPath}`;
}

async function removeObject(objectKey, { bucket } = {}) {
  const config = getStorageConfiguration();
  ensureConfigured(config);

  if (!objectKey) {
    return;
  }

  const targetBucket = bucket ?? config.bucket;
  const encodedBucket = encodeURIComponent(targetBucket);
  const encodedKey = encodeObjectKey(objectKey);
  const deleteUrl = `${config.url}/storage/v1/object/${encodedBucket}/${encodedKey}`;

  const response = await fetch(deleteUrl, {
    method: 'DELETE',
    headers: buildAuthHeaders(config),
  });

  if (!response.ok && response.status !== 404) {
    const errorText = await readResponseBody(response);
    throw createStorageError(
      `Failed to delete object from storage: ${errorText || response.statusText}`,
      'SUPABASE_DELETE_FAILED'
    );
  }
}

const exportsObject = {
  uploadBuffer,
  createSignedUrl,
  removeObject,
  buildObjectKey,
  isStorageConfigured,
  getStorageConfiguration,
  getDefaultBucket: () => getStorageConfiguration().bucket,
  getDefaultPrefix: () => getStorageConfiguration().prefix,
};

Object.defineProperty(exportsObject, 'DEFAULT_BUCKET', {
  enumerable: true,
  get: () => exportsObject.getDefaultBucket(),
});

Object.defineProperty(exportsObject, 'DEFAULT_PREFIX', {
  enumerable: true,
  get: () => exportsObject.getDefaultPrefix(),
});

module.exports = exportsObject;