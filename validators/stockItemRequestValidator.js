const createHttpError = require("../utils/httpError");

const TEXT_LIMITS = Object.freeze({
  name: 120,
  description: 500,
  unit: 50,
  review_notes: 500,
  legacy_creation_reason: 1000,
});

const validationError = (message, details = []) => {
  const error = createHttpError(400, message);
  error.code = "stock_item_request_validation_failed";
  error.details = details;
  return error;
};

const parsePositiveId = (value) => {
  if (!/^[1-9]\d*$/.test(String(value))) {
    throw validationError("Invalid request identifier", ["id"]);
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id)) {
    throw validationError("Invalid request identifier", ["id"]);
  }
  return id;
};

const trimOptionalText = (value, field) => {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw validationError(`${field} must be text`, [field]);
  }
  const normalized = value.trim();
  if (normalized.length > TEXT_LIMITS[field]) {
    throw validationError(
      `${field} must be ${TEXT_LIMITS[field]} characters or fewer`,
      [field],
    );
  }
  return normalized || null;
};

const rejectUnknownFields = (body, allowed) => {
  const unknown = Object.keys(body).filter((field) => !allowed.includes(field));
  if (unknown.length) {
    throw validationError(`Unknown field: ${unknown[0]}`, unknown);
  }
};

const validateReview = (params = {}, body = {}) => {
  rejectUnknownFields(body, [
    "status",
    "review_notes",
    "legacy_creation_reason",
  ]);
  if (!['approved', 'rejected'].includes(body.status)) {
    throw validationError("status must be approved or rejected", ["status"]);
  }
  const reason = trimOptionalText(
    body.legacy_creation_reason,
    "legacy_creation_reason",
  );
  if (body.status === "approved" && !reason) {
    throw validationError(
      "An explicit legacy creation reason is required",
      ["legacy_creation_reason"],
    );
  }
  return {
    id: parsePositiveId(params.id),
    status: body.status,
    reviewNotes: trimOptionalText(body.review_notes, "review_notes"),
    legacyCreationReason: reason,
  };
};

module.exports = { TEXT_LIMITS, parsePositiveId, validateReview };