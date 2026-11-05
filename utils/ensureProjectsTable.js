const pool = require('../config/db');

let projectsEnsured = false;

/**
 * Ensure project master data storage and request project links exist.
 *
 * Some deployed databases predate project tracking, so request creation can
 * fail when the app sends an optional project_id unless these structures are
 * lazily backfilled before the projects/requests endpoints run.
 */
const ensureProjectsTable = async (client = pool) => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureProjectsTable.js#ensureProjectsTable", client);
};

module.exports = ensureProjectsTable;