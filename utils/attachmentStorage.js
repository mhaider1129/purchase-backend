const path = require("path");
const fs = require("fs/promises");
const sanitize = require("sanitize-filename");

const { UPLOADS_DIR } = require("./attachmentPaths");
const { uploadBuffer, isStorageConfigured } = require("./storage");

function buildSegments({ requestId = null, itemId = null } = {}) {
  const segments = [requestId != null ? `request-${requestId}` : "general"];
  if (itemId != null) {
    segments.push(`item-${itemId}`);
  }
  return segments;
}

function sanitizeSegment(segment) {
  const normalized = String(segment || "")
    .trim()
    .replace(/\s+/g, "_");
  return sanitize(normalized) || "segment";
}

function buildLocalFileName(originalName) {
  const base = sanitize(originalName || "attachment");
  const timestamp = Date.now();
  return `${timestamp}-${base || "attachment"}`;
}

async function storeLocally({ file, segments }) {
  const relativeDirSegments = ["uploads", ...segments];
  const absoluteDirPath = path.join(UPLOADS_DIR, ...segments);

  await fs.mkdir(absoluteDirPath, { recursive: true });

  const fileName = buildLocalFileName(file.originalname);
  const absoluteFilePath = path.join(absoluteDirPath, fileName);
  await fs.writeFile(absoluteFilePath, file.buffer);

  const objectKey = path.posix.join(...relativeDirSegments, fileName);
  return { objectKey, storage: "local" };
}

async function storeAttachmentFile({ file, requestId = null, itemId = null } = {}) {
  if (!file || !file.buffer || file.buffer.length === 0) {
    const error = new Error("Uploaded file is empty");
    error.code = "ATTACHMENT_EMPTY_FILE";
    throw error;
  }

  const segments = buildSegments({ requestId, itemId }).map(sanitizeSegment);

  if (!isStorageConfigured()) {
    return storeLocally({ file, segments });
  }

  const result = await uploadBuffer({ file, segments });
  return { ...result, storage: "supabase" };
}

module.exports = {
  storeAttachmentFile,
  buildSegments,
  sanitizeSegment,
  buildLocalFileName,
};