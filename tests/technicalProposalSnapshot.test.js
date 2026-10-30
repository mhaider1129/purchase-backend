const {
  prepare,
  assertCurrent,
} = require("../services/technicalProposalSnapshot");
const {
  fingerprint,
} = require("../services/preprocurementTechnicalReviewModel");
test("proposal snapshots use canonical supplier names and reject foreign or inactive suppliers", async () => {
  const db = {
    query: jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 3, name: "Canonical supplier" }] })
      .mockResolvedValue({ rows: [] }),
  };
  const evidence = { supplier_id: "3", supplier_name: "Forged" };
  await prepare(db, { institute_id: 1 }, evidence, 4);
  expect(evidence.supplier_name).toBe("Canonical supplier");
  await expect(
    prepare(db, { institute_id: 1 }, { supplier_id: "4" }, 4),
  ).rejects.toMatchObject({ statusCode: 400 });
});
test("supplier/product replacement cannot reuse approval even before a PO is issued", async () => {
  await expect(
    assertCurrent({}, { supplier_id: "3" }, { supplier_id: "4" }),
  ).rejects.toMatchObject({ code: "TECHNICAL_PROPOSAL_CHANGED" });
  await expect(
    assertCurrent({}, { approved_product_id: "5" }, {}),
  ).rejects.toMatchObject({ code: "TECHNICAL_PROPOSAL_CHANGED" });
});
test("a revised quotation cannot reuse the same source ID approval", async () => {
  const original = { id: 7, supplier_id: 3, offered_specs: "Original" },
    evidence = {
      supplier_id: "3",
      quotation_item_id: "7",
      quotation_fingerprint: fingerprint(original),
    };
  const db = {
    query: jest
      .fn()
      .mockResolvedValue({
        rows: [{ ...original, offered_specs: "Changed model" }],
      }),
  };
  await expect(
    assertCurrent(db, evidence, {
      supplier_id: 3,
      source_type: "QUOTATION",
      source_id: 7,
    }),
  ).rejects.toMatchObject({ code: "TECHNICAL_PROPOSAL_CHANGED" });
  expect(db.query).toHaveBeenCalled();
});
test("material approved-product changes invalidate technical clearance", async () => {
  const product = { id: 5, product_name: "Model A" },
    db = {
      query: jest
        .fn()
        .mockResolvedValue({
          rows: [{ product: { ...product, product_name: "Model B" } }],
        }),
    };
  await expect(
    assertCurrent(
      db,
      { approved_product_id: "5", product_fingerprint: fingerprint(product) },
      { approved_product_id: 5 },
    ),
  ).rejects.toMatchObject({ code: "TECHNICAL_PROPOSAL_CHANGED" });
});
