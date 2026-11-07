const { clientClass } = require("../utils/runtimeDatabaseIdentity");
function base({ fail = false } = {}) {
  return class {
    constructor() {
      this.calls = [];
    }
    async connect() {
      this.calls.push("connect");
    }
    async query(sql) {
      this.calls.push(sql);
      if (fail) throw Error("role unavailable");
    }
    async end() {
      this.calls.push("end");
    }
  };
}
test("default identity does not change existing connection behavior", () => {
  const Client = base();
  expect(clientClass(undefined, Client)).toBe(Client);
});
test("only the reviewed restricted role may be selected", () => {
  expect(() => clientClass("postgres", base())).toThrow(
    "Unsupported runtime database role",
  );
});
test("physical connection becomes usable only after SET ROLE", async () => {
  const Runtime = clientClass("purchase_backend", base());
  const client = new Runtime();
  await client.connect();
  expect(client.calls).toEqual([
    "connect",
    "SET ROLE purchase_backend",
    "SET search_path = public, extensions, pg_catalog",
  ]);
});
test("pool callback waits for role setup; failed setup closes the connection", async () => {
  const Runtime = clientClass("purchase_backend", base({ fail: true }));
  const client = new Runtime();
  await new Promise((resolve) =>
    client.connect((error) => {
      expect(error.message).toBe("role unavailable");
      expect(client.calls).toContain("end");
      resolve();
    }),
  );
});
