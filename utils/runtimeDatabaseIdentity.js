"use strict";
const { Client } = require("pg");
function clientClass(role = process.env.DB_RUNTIME_ROLE, BaseClient = Client) {
  if (!role) return BaseClient;
  if (role !== "purchase_backend")
    throw Object.assign(new Error("Unsupported runtime database role"), {
      code: "DATABASE_RUNTIME_ROLE_INVALID",
    });
  return class TrustedRuntimeClient extends BaseClient {
    connect(callback) {
      const ready = super
        .connect()
        .then(() => super.query("SET ROLE purchase_backend"))
        .then(() =>
          super.query("SET search_path = public, extensions, pg_catalog"),
        )
        .then(() => undefined)
        .catch(async (error) => {
          await this.end().catch(() => {});
          throw error;
        });
      if (typeof callback === "function") {
        ready.then(() => callback(null), callback);
        return;
      }
      return ready;
    }
  };
}
module.exports = { clientClass };
