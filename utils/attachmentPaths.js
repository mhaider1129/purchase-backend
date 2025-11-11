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

  return path.join(UPLOADS_DIR, relativePath);
}

function serializeAttachment(row) {
  if (!row) return row;

  const storedPath = (row.file_path || '').replace(/\\/g, '/');
  const isLocal = isStoredLocally(storedPath);
  const filename = row.file_name || (storedPath ? path.basename(storedPath) : 'attachment');

  let downloadUrl = null;

  if (isLocal && storedPath) {
    downloadUrl = `/api/attachments/download/${encodeURIComponent(path.basename(storedPath))}`;
  } else if (row.id) {
    downloadUrl = `/api/attachments/${row.id}/download`;
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

  if (storedPath) {
    result.file_path = storedPath;
    result.filePath = storedPath;
  }

  if (isLocal && storedPath) {
    result.file_url = `/${storedPath}`;
    result.fileUrl = `/${storedPath}`;
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