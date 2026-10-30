"use strict";
// Legacy metadata shape and delete URL delegate to the canonical object policy.
// No signed bearer URL is minted; callers download through the authenticated API.
const canonical = require("./attachmentsController");
module.exports = {
  getFileById: canonical.metadata,
  deleteFile: canonical.remove,
};
