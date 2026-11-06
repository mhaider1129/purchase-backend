const pool = require('../config/db');

let initialized = false;
let initializingPromise = null;

const ensureTechnicalInspectionsTable = async (client = pool) => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureTechnicalInspectionsTable.js#ensureTechnicalInspectionsTable", client);
};

module.exports = ensureTechnicalInspectionsTable;