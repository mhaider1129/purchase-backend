const pool = require('../config/db');

let tableEnsured = false;

const ensureRequestedItemFinancialsTable = async (client = pool) => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureRequestedItemFinancialsTable.js#ensureRequestedItemFinancialsTable", client);
};

module.exports = { ensureRequestedItemFinancialsTable };