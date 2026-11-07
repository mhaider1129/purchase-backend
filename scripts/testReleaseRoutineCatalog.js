"use strict";
// Disposable loopback PostgreSQL only. No application configuration or dotenv.
const { execFileSync } = require("node:child_process"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict");
const { Client } = require("pg");
const { disposableDatabaseUrl } = require("../integration/disposableDatabase");
const images = {
  16: "postgres:16-bookworm@sha256:efedf3595f1d6f415c08568ba171029bf54052e754cc9f030e3f2412b21f3d67",
  17: "postgres:17-bookworm@sha256:665dc7b37ac52a17e298511414c21d23ffa4e6a6ef6225b3e5d59c7afb35e994",
};
(async () => {
  const at = process.argv.indexOf("--major"),
    major = at < 0 ? 17 : Number(process.argv[at + 1]);
  if (!images[major]) throw Error("ONLY_DISPOSABLE_POSTGRES16_OR_17_SUPPORTED");
  const password = crypto.randomBytes(24).toString("hex"),
    name = "p2p_disposable_" + crypto.randomBytes(8).toString("hex");
  const docker = (args) =>
    execFileSync("docker", ["--host=unix:///var/run/docker.sock", ...args], {
      encoding: "utf8",
      env: { ...process.env, POSTGRES_PASSWORD: password },
    }).trim();
  let container, client;
  try {
    container = docker([
      "run",
      "--detach",
      "--rm",
      "--tmpfs",
      "/var/lib/postgresql/data:rw",
      "--publish",
      "127.0.0.1::5432",
      "--env",
      "POSTGRES_PASSWORD",
      "--env",
      "POSTGRES_USER=p2p_test",
      "--env",
      "POSTGRES_DB=" + name,
      images[major],
    ]);
    const address = docker(["port", container, "5432/tcp"]),
      url = disposableDatabaseUrl(
        `postgresql://p2p_test:${password}@${address}/${name}`,
      );
    for (let i = 0; i < 150; i++) {
      client = new Client({ connectionString: url });
      try {
        await client.connect();
        break;
      } catch (e) {
        await client.end();
        if (i === 149) throw e;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert.equal(
      Math.floor(
        Number(
          (await client.query("SHOW server_version_num")).rows[0]
            .server_version_num,
        ) / 10000,
      ),
      major,
    );
    assert.equal(
      Number(
        (
          await client.query(
            "SELECT count(*) n FROM information_schema.tables WHERE table_schema='public'",
          )
        ).rows[0].n,
      ),
      0,
    );
    await require("../integration/releaseRoutineCatalog.postgres")(client, url);
    console.log("Disposable PostgreSQL major verified: " + major);
  } finally {
    if (client) await client.end();
    if (container) docker(["rm", "--force", container]);
  }
})().catch((e) => {
  console.error(e.code || "ROUTINE_CATALOG_TEST_FAILED", e.stack || e.message);
  process.exitCode = 1;
});
