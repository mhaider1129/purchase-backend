const pool = require('../config/db');

let maintenanceRequestSchemaEnsured = false;

/**
 * Backfill additive columns used by maintenance request submissions.
 *
 * Long-lived deployments can have a requests table created before maintenance
 * workflows gained technician tracking, target sections, and temporary
 * requester names. Ensuring those columns before insert prevents valid
 * maintenance submissions from failing with an opaque 500.
 */
const ensureMaintenanceRequestSchema = async (client = pool) => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureMaintenanceRequestSchema.js#ensureMaintenanceRequestSchema", client);
};

module.exports = ensureMaintenanceRequestSchema;