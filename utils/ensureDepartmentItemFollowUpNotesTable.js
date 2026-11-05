const pool = require('../config/db');

let ensured = false;

const ensureDepartmentItemFollowUpNotesTable = async () => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureDepartmentItemFollowUpNotesTable.js#ensureDepartmentItemFollowUpNotesTable", pool);
};

module.exports = ensureDepartmentItemFollowUpNotesTable;