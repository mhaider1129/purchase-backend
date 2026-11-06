const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const walk = (d) =>
  fs
    .readdirSync(d, { withFileTypes: true })
    .flatMap((e) =>
      ["node_modules", "tests", "__tests__", "integration"].includes(e.name)
        ? []
        : e.isDirectory()
          ? walk(path.join(d, e.name))
          : [path.join(d, e.name)],
    ); // This runner creates a new, loopback-only disposable database; its inserts are fixtures.
const fixtureRunner = "scripts/testBackendSchemaReconciliation.js";
const production = walk(root).filter(
  (f) => f.endsWith(".js") && path.relative(root, f) !== fixtureRunner,
);
const canonical = [
  "generic_items",
  "approved_products",
  "supplier_catalog_items",
  "item_categories",
  "item_manufacturers",
  "item_uom",
];
const approved = new Set(["services/itemMasterFoundationService.js"]);
const violationsFor = (files, base = root) => {
  const violations = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const table of canonical)
      if (
        new RegExp(
          String.raw`\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:"?public"?\.)?"?${table}\b`,
          "i",
        ).test(text) &&
        !approved.has(path.relative(base, file))
      )
        violations.push(path.relative(base, file) + ":" + table);
  }
  return violations;
};
test("canonical item DML is confined to the approved service", () =>
  expect(violationsFor(production)).toEqual([]));
test.each([
  "INSERT INTO generic_items",
  "UPDATE public.approved_products",
  'DELETE FROM \"public\".\"item_uom\"',
])("foreign-writer mutation remains blocked: %s", (sql) => {
  const temporary = fs.mkdtempSync(
    path.join(require("os").tmpdir(), "writer-boundary-"),
  );
  try {
    fs.mkdirSync(path.join(temporary, "services"));
    const file = path.join(temporary, "services", "unapproved.js");
    fs.writeFileSync(file, sql);
    expect(violationsFor(walk(temporary), temporary)).toHaveLength(1);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
test("canonical code does not resolve final identity by a display name", () => {
  const text = fs.readFileSync(
    path.join(root, "services/itemMasterFoundationService.js"),
    "utf8",
  );
  expect(text).not.toMatch(
    /WHERE\s+(?:LOWER\s*\(\s*name|TRIM\s*\(\s*item_name|description\s+ILIKE)[\s\S]{0,80}(?:LIMIT\s+1|INSERT)/i,
  );
});

test("excluded schema fixture runner validates disposable database URLs", () => {
  expect(fs.readFileSync(path.join(root, fixtureRunner), "utf8")).toContain(
    "disposableDatabaseUrl(",
  );
});
