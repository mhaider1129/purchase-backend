const ensureRequestEditApprovalsTable = async (clientOrPool) => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureRequestEditApprovalsTable.js#ensureRequestEditApprovalsTable", clientOrPool);
};

module.exports = ensureRequestEditApprovalsTable;