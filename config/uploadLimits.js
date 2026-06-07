const DEFAULT_ATTACHMENT_MAX_SIZE_MB = 50;
const DEFAULT_ATTACHMENT_MAX_FILES = 20;
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

function getAttachmentMaxFiles() {
  return Math.round(
    parsePositiveNumber(process.env.ATTACHMENT_MAX_FILES) || DEFAULT_ATTACHMENT_MAX_FILES
  );
}

function getRequestBodyLimitMb() {
  return parsePositiveNumber(process.env.REQUEST_BODY_LIMIT_MB) || getAttachmentMaxSizeMb();
}

function getRequestBodyLimit() {
  return `${getRequestBodyLimitMb()}mb`;
}

module.exports = {
  DEFAULT_ATTACHMENT_MAX_FILES,
  DEFAULT_ATTACHMENT_MAX_SIZE_MB,
  BYTES_PER_MB,
  getAttachmentMaxFiles,
  getAttachmentMaxSizeMb,
  getAttachmentMaxSizeBytes,
  getRequestBodyLimit,
  getRequestBodyLimitMb,
};