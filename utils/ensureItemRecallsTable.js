const pool = require('../config/db');

let ensured = false;
let ensuringPromise = null;

const ensureItemRecallsTable = async (client = pool) => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureItemRecallsTable.js#ensureItemRecallsTable", client);
};

module.exports = ensureItemRecallsTable;