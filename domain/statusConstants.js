const existingCatalog = require('../constants/statusCatalog');

const ENTITY_TYPES = Object.freeze({ REQUEST: 'request', APPROVAL: 'approval' });
const STATUS = Object.freeze({
  REQUEST: existingCatalog.REQUEST_STATUS,
  APPROVAL: existingCatalog.APPROVAL_STATUS,
});
const STATUS_ALIASES = Object.freeze({ pending: 'Pending', approved: 'Approved', rejected: 'Rejected' });

module.exports = { ENTITY_TYPES, STATUS, STATUS_ALIASES };