const pool = require('../config/db');

let tablesEnsured = false;
let approvalColumnsEnsured = false;

const ensureWarehouseSupplyTables = async (client = pool) => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureWarehouseSupplyTables.js#ensureWarehouseSupplyTables", client);
};

const ensureWarehouseSupplyApprovalColumns = async (client = pool) => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureWarehouseSupplyTables.js#ensureWarehouseSupplyApprovalColumns", client);
};

module.exports = { ensureWarehouseSupplyTables, ensureWarehouseSupplyApprovalColumns };