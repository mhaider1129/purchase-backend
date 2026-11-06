const pool = require('../config/db');

let tablesEnsured = false;

const ensureWarehouseTransferTables = async (client = pool) => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureWarehouseTransferTables.js#ensureWarehouseTransferTables", client);
};

module.exports = ensureWarehouseTransferTables;