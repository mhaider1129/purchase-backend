const pool = require('../config/db');

let columnEnsured = false;

const ensureApprovalReminderColumn = async (client = pool) => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureApprovalReminderColumn.js#ensureApprovalReminderColumn", client);
};

module.exports = ensureApprovalReminderColumn;
