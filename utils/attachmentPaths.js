const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..');
const UPLOADS_DIR = path.join(BACKEND_ROOT, 'uploads');

function normalizeRelativeUploadsPath(absolutePath) {
  const relativeToUploads = path.relative(UPLOADS_DIR, absolutePath);
  if (relativeToUploads && !relativeToUploads.startsWith('..')) {
    return relativeToUploads.replace(/\\/g, '/');
  }

  return path.basename(absolutePath);
}

function toStoredPath(filePath) {
  if (!filePath) return '';

  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(BACKEND_ROOT, filePath);

  const normalizedRelative = normalizeRelativeUploadsPath(absolutePath);
  return path.join('uploads', normalizedRelative).replace(/\\/g, '/');
}

function serializeAttachment(row) {
  if (!row) return row;

  const storedPath = row.file_path || '';
  const absolutePath = path.isAbsolute(storedPath)
    ? storedPath
    : path.resolve(BACKEND_ROOT, storedPath);

  const normalizedRelative = normalizeRelativeUploadsPath(absolutePath);
  const normalizedPath = path.join('uploads', normalizedRelative).replace(/\\/g, '/');
  const filename = path.basename(normalizedRelative);

  return {
    ...row,
    file_path: normalizedPath,
    file_url: `/${normalizedPath}`,
    download_url: `/api/attachments/download/${encodeURIComponent(filename)}`,
  };
}

module.exports = {
  BACKEND_ROOT,
  UPLOADS_DIR,
  toStoredPath,
  serializeAttachment,
};