const {
  parsePositiveId,
  validateReview,
} = require("../validators/stockItemRequestValidator");
const {
  normalizeLegacyStockItemName,
} = require("../repositories/legacyStockItemRepository");

describe("stock item request validation", () => {
  test.each(["NaN", "0", "-1", "1.5", " 1", "1x"])(
    "rejects malformed identifier %s",
    (id) => expect(() => parsePositiveId(id)).toThrow("Invalid request identifier"),
  );

  it("trims an approved review payload", () => {
    expect(validateReview({ id: "8" }, {
      status: "approved",
      review_notes: "  reviewed  ",
      legacy_creation_reason: "  emergency exception  ",
    })).toEqual({
      id: 8,
      status: "approved",
      reviewNotes: "reviewed",
      legacyCreationReason: "emergency exception",
    });
  });

  it("allows rejection without a legacy reason", () => {
    expect(validateReview({ id: "8" }, { status: "rejected" }))
      .toEqual(expect.objectContaining({ legacyCreationReason: null }));
  });

  it("rejects unknown fields with a stable code", () => {
    expect.assertions(1);
    try {
      validateReview({ id: "8" }, { status: "rejected", stock_item_id: 9 });
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 400,
        code: "stock_item_request_validation_failed",
        details: ["stock_item_id"],
      });
    }
  });
});

describe("legacy Stock Item identity", () => {
  test.each([
    "Exact Name",
    "exact name",
    " EXACT   NAME",
    "Ｅｘａｃｔ　Ｎａｍｅ",
  ])("normalizes %s to one deterministic key", (name) => {
    expect(normalizeLegacyStockItemName(name)).toBe("exact name");
  });
});