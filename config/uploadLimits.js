const DEFAULT_ATTACHMENT_MAX_SIZE_MB = 50;
const BYTES_PER_MB = 1024 * 1024;

function parsePositiveNumber(value) {
  if (value == null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getAttachmentMaxSizeMb() {
  return parsePositiveNumber(process.env.ATTACHMENT_MAX_SIZE_MB) || DEFAULT_ATTACHMENT_MAX_SIZE_MB;
}

function getAttachmentMaxSizeBytes() {
  return Math.round(getAttachmentMaxSizeMb() * BYTES_PER_MB);
}

module.exports = {
  DEFAULT_ATTACHMENT_MAX_SIZE_MB,
  BYTES_PER_MB,
  getAttachmentMaxSizeMb,
  getAttachmentMaxSizeBytes,
};