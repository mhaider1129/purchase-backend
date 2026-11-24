"use strict";
// OFFLINE ONLY. Generates private files; never connects or changes credentials.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
function prepare({
  ownerUrl,
  role = "wici_purchase_runtime",
  password = crypto.randomBytes(32).toString("base64url"),
  releaseRef = "wici-recovery-2026-11-07-r2",
}) {
  if (
    !/^[a-z][a-z0-9_]{2,62}$/.test(role) ||
    [
      "postgres",
      "purchase_backend",
      "anon",
      "authenticated",
      "service_role",
    ].includes(role)
  )
    throw Error("A new dedicated login role is required");
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(releaseRef))
    throw Error("Invalid release reference");
  const url = new URL(ownerUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw Error("PostgreSQL URL required");
  if (!/^[A-Za-z0-9_-]{32,}$/.test(password))
    throw Error("Use a strong generated password");
  const suffix = url.username.includes(".")
    ? "." + url.username.split(".").slice(1).join(".")
    : "";
  url.username = role + suffix;
  url.password = password;
  for (const key of ["options", "user", "username", "password"])
    url.searchParams.delete(key);
  if (url.hostname.endsWith(".pooler.supabase.com") && url.port === "6543")
    url.port = "5432";
  const sql = `-- MANUAL EXECUTION ONLY. Private generated secret: do not commit, upload or paste into chat.\nBEGIN;\nDO $identity$ BEGIN\n IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN RAISE EXCEPTION 'RUNTIME_ROLE_ALREADY_EXISTS_REVIEW_REQUIRED'; END IF;\n IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='purchase_backend' AND rolbypassrls AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole) THEN RAISE EXCEPTION 'BACKEND_GRANT_ROLE_REQUIRES_REVIEW'; END IF;\n CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}';\n GRANT purchase_backend TO ${role};\nEND $identity$;\nCOMMIT;\n`;
  const environment = `# Merge these keys into the server .env; retain all other settings.\nDATABASE_URL=${url.toString()}\nDB_RELEASE_SCHEMA_PROFILE=wici-2026-11\nDB_RUNTIME_ROLE=purchase_backend\nAPP_RELEASE_REF=${releaseRef}\nDB_RELEASE_ENVIRONMENT=production\nHOST=127.0.0.1\nPORT=5000\nLIVE_ROUTING_ENABLED=false\n`;
  return { sql, environment };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i < 0 ? fallback : args[i + 1];
  };
  const output = value("--output-dir");
  if (!output)
    throw Error("An output directory outside the repository is required");
  const root = path.resolve(__dirname, "..");
  const dest = path.join(
    fs.realpathSync(path.dirname(path.resolve(output))),
    path.basename(path.resolve(output)),
  );
  for (let ancestor = path.dirname(dest); ; ancestor = path.dirname(ancestor)) {
    if (fs.existsSync(path.join(ancestor, ".git")))
      throw Error("Secret outputs must be outside every Git repository");
    if (path.dirname(ancestor) === ancestor) break;
  }
  if (fs.existsSync(dest)) throw Error("Choose a new private output directory");
  if (dest === root || dest.startsWith(root + path.sep))
    throw Error("Secret outputs must be outside the repository");
  const input = value("--env-file", path.join(root, ".env"));
  const env = require("dotenv").parse(fs.readFileSync(input));
  if (!env.DATABASE_URL)
    throw Error("Source environment file has no DATABASE_URL");
  const result = prepare({
    ownerUrl: env.DATABASE_URL,
    role: value("--role", "wici_purchase_runtime"),
    releaseRef: value("--release", "wici-recovery-2026-11-07-r2"),
  });
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dest, "runtime-identity.sql"), result.sql, {
    mode: 0o600,
    flag: "wx",
  });
  fs.writeFileSync(path.join(dest, "runtime.env"), result.environment, {
    mode: 0o600,
    flag: "wx",
  });
  console.log(
    "OFFLINE_PRIVATE_FILES_CREATED. Execute runtime-identity.sql manually, then merge runtime.env locally. Never share these files.",
  );
}
module.exports = { prepare };
