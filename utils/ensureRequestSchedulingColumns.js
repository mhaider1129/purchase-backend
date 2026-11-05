const pool = require('../config/db');

let ensured = false;
let ensurePromise = null;

const ensureRequestSchedulingColumns = async () => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureRequestSchedulingColumns.js#ensureRequestSchedulingColumns", pool);
};

module.exports = ensureRequestSchedulingColumns;