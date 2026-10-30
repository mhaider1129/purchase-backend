const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..');
const UPLOADS_DIR = path.join(BACKEND_ROOT, 'uploads');

function isStoredLocally(storedPath = '') {
  if (!storedPath) return false;
  const normalized = storedPath.replace(/\\/g, '/');
  return normalized.startsWith('uploads/');
}

function resolveStoredLocalPath(storedPath = '') {
  if (!storedPath) return null;

  const normalized = storedPath.replace(/\\/g, '/');
  if (!isStoredLocally(normalized)) {
    return null;
  }

  const relativePath = normalized.startsWith('uploads/')
    ? normalized.slice('uploads/'.length)
    : normalized;

  const resolved = path.resolve(UPLOADS_DIR, relativePath);
  const within = path.relative(UPLOADS_DIR, resolved);
  if (!within || within === '..' || within.startsWith(`..${path.sep}`) || path.isAbsolute(within)) return null;
  return resolved;
}

function serializeAttachment(row) {
  if (!row) return row;

  const storedPath = (row.file_path || '').replace(/\\/g, '/');
  const isLocal = isStoredLocally(storedPath);
  const filename = row.file_name || (storedPath ? path.basename(storedPath) : 'attachment');
  const itemId = row.item_id ?? row.itemId ?? null;
  const itemName = row.item_name || row.itemName;

  let downloadUrl = null;

  if (row.id) {
    // API clients are configured with `/api` as their base URL.  Returning an
    // API-prefixed relative URL makes axios request `/api/api/...`.
    downloadUrl = `/attachments/${row.id}/download`;
  }

  const result = {
    id: row.id,
    file_name: filename,
    fileName: filename,
    download_url: downloadUrl,
    url: downloadUrl,
    uploaded_by: row.uploaded_by,
    uploaded_at: row.uploaded_at,
  };

  if (itemId !== null && itemId !== undefined) {
    result.item_id = itemId;
    result.itemId = itemId;
  }

  if (itemName) {
    result.item_name = itemName;
    result.itemName = itemName;
  }

  if (storedPath) {
    result.file_path = storedPath;
    result.filePath = storedPath;
  }

  if (isLocal && storedPath) {
    result.file_url = downloadUrl;
    result.fileUrl = downloadUrl;
  }

  return result;
}

module.exports = {
  BACKEND_ROOT,
  UPLOADS_DIR,
  serializeAttachment,
  isStoredLocally,
  resolveStoredLocalPath,
};