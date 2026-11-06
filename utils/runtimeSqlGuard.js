"use strict";
// Persistent schema/release authority is never granted by an HTTP request.
const installed = new WeakSet();
function assertRuntimeSql(query) {
  const text = typeof query === "string" ? query : query?.text;
  if (typeof text !== "string") return;
  const {
    splitStatements,
    leadingKeyword,
  } = require("../scripts/lib/databaseRelease/sqlStatements");
  const statements = splitStatements(text);
  for (const statement of statements) {
    if (
      [
        "CREATE",
        "ALTER",
        "DROP",
        "TRUNCATE",
        "GRANT",
        "REVOKE",
        "DO",
        "COMMENT",
        "REINDEX",
        "VACUUM",
      ].includes(leadingKeyword(statement))
    )
      throw Object.assign(
        new Error(
          "Runtime schema changes are disabled; review the manual database release plan",
        ),
        { code: "RUNTIME_DDL_DISABLED", statusCode: 503 },
      );
  }
}
function guard(runner) {
  if (!runner || installed.has(runner)) return runner;
  installed.add(runner);
  const original = runner.query;
  runner.query = function (query, ...args) {
    try {
      assertRuntimeSql(query);
    } catch (e) {
      const callback = args.at(-1);
      if (typeof callback === "function") {
        queueMicrotask(() => callback(e));
        return;
      }
      return Promise.reject(e);
    }
    return original.call(this, query, ...args);
  };
  return runner;
}
module.exports = { guard, assertRuntimeSql };
