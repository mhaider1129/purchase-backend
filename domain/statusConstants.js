const existingCatalog = require('../constants/statusCatalog');

const ENTITY_TYPES = Object.freeze({ REQUEST: 'request', APPROVAL: 'approval' });

// Values in this object deliberately retain the title-cased values already stored
// by the application. Aliases are accepted at service boundaries only.
const REQUEST_STATUS = Object.freeze({
  DRAFT: 'Draft',
  SUBMITTED: existingCatalog.REQUEST_STATUS.SUBMITTED,
  PENDING: existingCatalog.REQUEST_STATUS.PENDING,
  UNDER_APPROVAL: existingCatalog.REQUEST_STATUS.PENDING,
  RETURNED: 'Returned',
  APPROVED: existingCatalog.REQUEST_STATUS.APPROVED,
  REJECTED: existingCatalog.REQUEST_STATUS.REJECTED,
  CANCELLED: 'Cancelled',
  WITHDRAWN: 'Cancelled',
  IN_PROGRESS: 'In Progress',
  PROCUREMENT: 'In Progress',
  RECEIVED: existingCatalog.REQUEST_STATUS.RECEIVED,
  COMPLETED: existingCatalog.REQUEST_STATUS.COMPLETED,
  CLOSED: existingCatalog.REQUEST_STATUS.CLOSED,
  AVAILABLE_IN_STOCK: existingCatalog.REQUEST_STATUS.AVAILABLE_IN_STOCK,
});

const STATUS = Object.freeze({ REQUEST: REQUEST_STATUS, APPROVAL: existingCatalog.APPROVAL_STATUS });
const STATUS_ALIASES = Object.freeze({
  draft: REQUEST_STATUS.DRAFT, submitted: REQUEST_STATUS.SUBMITTED,
  pending: REQUEST_STATUS.PENDING, 'under approval': REQUEST_STATUS.PENDING,
  returned: REQUEST_STATUS.RETURNED, 'returned for correction': REQUEST_STATUS.RETURNED,
  approved: REQUEST_STATUS.APPROVED, rejected: REQUEST_STATUS.REJECTED,
  cancelled: REQUEST_STATUS.CANCELLED, canceled: REQUEST_STATUS.CANCELLED,
  withdrawn: REQUEST_STATUS.CANCELLED, procurement: REQUEST_STATUS.IN_PROGRESS,
  'in progress': REQUEST_STATUS.IN_PROGRESS, received: REQUEST_STATUS.RECEIVED,
  completed: REQUEST_STATUS.COMPLETED, closed: REQUEST_STATUS.CLOSED,
});

const normalizeStatus = value => {
  if (typeof value !== 'string' || !value.trim()) return value;
  return STATUS_ALIASES[value.trim().toLowerCase()] || value.trim();
};

module.exports = { ENTITY_TYPES, STATUS, REQUEST_STATUS, STATUS_ALIASES, normalizeStatus };