"use strict";
// Disposable fixtures only: genuinely execute 069 before testing its successor.
// This is never reachable from the release CLI or runtime worker.
const fs = require("fs"),
  path = require("path");
const { disposableDatabaseUrl } = require("./disposableDatabase");
module.exports = async (client, url, step = "069") => {
  disposableDatabaseUrl(url);
  const {
    inventory,
    root,
  } = require("../scripts/lib/databaseRelease/inventory");
  const manifest = inventory();
  manifest.artifacts = manifest.artifacts.map((row) => ({
    ...row,
    classification:
      row.id === step
        ? "active_forward_migration"
        : row.classification === "active_forward_migration"
          ? "test_fixture"
          : row.classification,
  }));
  const contract = JSON.parse(
    fs.readFileSync(
      path.join(
        root,
        `database/releases/prerequisites/${step}-schema-contract.json`,
      ),
      "utf8",
    ),
  );
  for (const environment of ["disposable", "staging"])
    await client.query(
      require("../scripts/lib/databaseRelease/planner").bundle({
        inventory: manifest,
        contract,
        ids: [
          path.basename(
            manifest.artifacts.find((row) => row.id === step).path,
            ".sql",
          ),
        ],
        environment,
        actor: "disposable-7a-prerequisite-test",
        releaseRef: `disposable-prerequisite-${step}`,
      }),
    );
};
