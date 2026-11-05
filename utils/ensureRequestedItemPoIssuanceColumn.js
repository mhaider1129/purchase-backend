const pool = require('../config/db');

let columnEnsured = false;

const ensureRequestedItemPoIssuanceColumn = async (client = pool) => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureRequestedItemPoIssuanceColumn.js#ensureRequestedItemPoIssuanceColumn", client);
};

module.exports = ensureRequestedItemPoIssuanceColumn;