const express = require("express"),
  request = require("supertest"),
  fs = require("fs");
jest.mock("../config/db", () => ({ query: jest.fn() }));
jest.mock("../middleware/authMiddleware", () => ({
  authenticateUser: (req, res, next) => {
    req.user = { id: 1 };
    next();
  },
}));
const router = require("../routes/attachments");
const app = express();
app.use("/attachments", router);
app.use((e, req, res, next) =>
  res.status(e.statusCode || 500).json({ message: e.message }),
);
test("legacy path downloads cannot traverse out of public uploads into private clinical storage", async () => {
  const access = jest.spyOn(fs, "access").mockImplementation(() => {
    throw new Error("Must not touch filesystem");
  });
  for (const p of [
    "../private-uploads/surgical-consignments/file.pdf",
    "uploads/../../private-uploads/clinical.pdf",
  ])
    expect(
      (await request(app).get("/attachments/download").query({ path: p }))
        .status,
    ).toBe(404);
  expect(access).not.toHaveBeenCalled();
});
