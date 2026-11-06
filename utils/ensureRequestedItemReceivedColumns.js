const pool = require('../config/db');

let columnsEnsured = false;

const ensureRequestedItemReceivedColumns = async (client = pool) => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureRequestedItemReceivedColumns.js#ensureRequestedItemReceivedColumns", client);
};

module.exports = ensureRequestedItemReceivedColumns;