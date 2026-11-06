const pool = require('../config/db');

let columnsEnsured = false;

const ensureRequestedItemApprovalColumns = async (client = pool) => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureRequestedItemApprovalColumns.js#ensureRequestedItemApprovalColumns", client);
};

module.exports = ensureRequestedItemApprovalColumns;