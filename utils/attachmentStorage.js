const sanitize = require("sanitize-filename");

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

async function storeAttachmentFile({ file, requestId = null, itemId = null } = {}) {
  if (!file || !file.buffer || file.buffer.length === 0) {
    const error = new Error("Uploaded file is empty");
    error.code = "ATTACHMENT_EMPTY_FILE";
    throw error;
  }

  const segments = buildSegments({ requestId, itemId }).map(sanitizeSegment);

  if (!isStorageConfigured()) {
    const error = new Error(
      "Supabase storage is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
    error.code = "SUPABASE_NOT_CONFIGURED";
    throw error;
  }

  const result = await uploadBuffer({ file, segments });
  return { ...result, storage: "supabase" };
}

module.exports = {
  storeAttachmentFile,
};