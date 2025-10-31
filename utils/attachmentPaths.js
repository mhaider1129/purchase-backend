const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..');
const UPLOADS_DIR = path.join(BACKEND_ROOT, 'uploads');

function isStoredLocally(storedPath = '') {
  if (!storedPath) return false;
  const normalized = storedPath.replace(/\\/g, '/');
  return normalized.startsWith('uploads/');
}

function serializeAttachment(row) {
  if (!row) return row;

  const storedPath = (row.file_path || '').replace(/\\/g, '/');
  const isLocal = isStoredLocally(storedPath);
  const filename = row.file_name || (storedPath ? path.basename(storedPath) : 'attachment');

  let fileUrl = null;
  let downloadUrl = null;

  if (isLocal && storedPath) {
    fileUrl = `/${storedPath}`;
    downloadUrl = `/api/attachments/download/${encodeURIComponent(path.basename(storedPath))}`;
  } else if (row.id) {
    downloadUrl = `/api/attachments/${row.id}/download`;
  }

  return {
    ...row,
    file_path: storedPath,
    file_url: fileUrl,
    download_url: downloadUrl,
    file_name: filename,
  };
}

module.exports = {
  BACKEND_ROOT,
  UPLOADS_DIR,
  serializeAttachment,
  isStoredLocally,
};