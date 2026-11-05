const pool = require('../config/db');

let ensured = false;
let ensurePromise = null;

const ensureRequestClientSubmissionKey = async () => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/ensureRequestClientSubmissionKey.js#ensureRequestClientSubmissionKey", pool);
};

module.exports = ensureRequestClientSubmissionKey;