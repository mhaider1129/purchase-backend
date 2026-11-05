const pool = require('../config/db');

const ensureRequestedItemUnitOfMeasureColumn = async (client = pool) => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureRequestedItemUnitOfMeasureColumn.js#ensureRequestedItemUnitOfMeasureColumn", client);
};

module.exports = ensureRequestedItemUnitOfMeasureColumn;