const pool = require('../config/db');

const ensureRiskRegisterTable = async () => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureRiskRegisterTable.js#ensureRiskRegisterTable", pool);
};

module.exports = ensureRiskRegisterTable;