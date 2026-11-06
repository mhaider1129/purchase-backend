const pool = require('../config/db');

const ensureMonthlyDispensingTables = async (client = pool) => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureMonthlyDispensingTables.js#ensureMonthlyDispensingTables", client);
};

module.exports = ensureMonthlyDispensingTables;