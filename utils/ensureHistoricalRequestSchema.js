const pool = require('../config/db');
const ensureProjectsTable = require('./ensureProjectsTable');
const ensureWarehouseAssignments = require('./ensureWarehouseAssignments');

let historicalRequestSchemaEnsured = false;

/** Validate the reviewed import schema without altering historical records. */
const ensureHistoricalRequestSchema = async (client = pool) => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureHistoricalRequestSchema.js#ensureHistoricalRequestSchema", client);
};

module.exports = ensureHistoricalRequestSchema;