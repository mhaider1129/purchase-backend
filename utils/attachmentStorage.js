const path = require("path");
const fs = require("fs/promises");
const sanitize = require("sanitize-filename");

const { UPLOADS_DIR } = require("./attachmentPaths");
const { uploadBuffer, isStorageConfigured } = require("./storage");

function buildSegments({ requestId = null, itemId = null, contractId = null } = {}) {
  const segments = [requestId != null ? `request-${requestId}` : "general"];
  if (itemId != null) {
    segments.push(`item-${itemId}`);
  }
  if (contractId != null) {
    segments.push(`contract-${contractId}`);
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

function isLocalFallbackEnabled() {
  const rawValue = String(process.env.ATTACHMENT_LOCAL_FALLBACK_ENABLED || '').trim().toLowerCase();

  if (!rawValue) {
    return true;
  }

  if (['false', '0', 'no', 'off', 'disabled'].includes(rawValue)) {
    return false;
  }

  // Treat any other explicit value as enabled so env values like
  // "enabled" or "on" do not unexpectedly disable the fallback.
  return true;
}

function createSharedStorageUploadError(err) {
  const error = new Error(
    "Failed to upload attachment to shared storage. Please check Supabase storage configuration and try again.",
  );
  error.code = "ATTACHMENT_SHARED_STORAGE_UPLOAD_FAILED";
  error.statusCode = 502;
  error.cause = err;
  return error;
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

async function storeAttachmentFile({ file, requestId = null, itemId = null, contractId = null } = {}) {
  if (!file || !file.buffer || file.buffer.length === 0) {
    const error = new Error("Uploaded file is empty");
    error.code = "ATTACHMENT_EMPTY_FILE";
    throw error;
  }

  const segments = buildSegments({ requestId, itemId, contractId }).map(sanitizeSegment);

  if (!isStorageConfigured()) {
    return storeLocally({ file, segments });
  }

  try {
    const result = await uploadBuffer({ file, segments });
    return { ...result, storage: "supabase" };
  } catch (err) {
    if (isLocalFallbackEnabled()) {
      console.warn(
        `⚠️ Failed to store attachment in Supabase; falling back to local filesystem storage: ${err.message}`,
      );
      return storeLocally({ file, segments });
    }

    console.error(
      `❌ Failed to store attachment in shared Supabase storage: ${err.message}`,
    );
    throw createSharedStorageUploadError(err);
  }
}

module.exports = {
  storeAttachmentFile,
  buildSegments,
  sanitizeSegment,
  buildLocalFileName,
  isLocalFallbackEnabled,
};