const pool = require('../config/db');

let ensurePromise = null;

const ensureItemMasterTables = async (client = pool) => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureItemMasterTables.js#ensureItemMasterTables", client);
};

module.exports = ensureItemMasterTables;