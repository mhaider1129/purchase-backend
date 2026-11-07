const express = require("express");
const pool = require("../config/db");
const upload = require("../middleware/upload");
const service = require("../services/guidedRequestService");
const {
  createRequest,
} = require("../controllers/requests/createRequestController");
const router = express.Router();
const route = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
router.use((req, res, next) => {
  try {
    service.enabled();
    next();
  } catch (error) {
    next(error);
  }
});
router.get(
  "/options",
  route(async (req, res) => res.json(await service.options(pool, req.user.id))),
);
router.get(
  "/catalog",
  route(async (req, res) =>
    res.json(await service.catalog(pool, req.user.id, req.query.q)),
  ),
);
router.post(
  "/preview",
  route(async (req, res) =>
    res.json(await service.preview(pool, req.user.id, req.body)),
  ),
);
router.post(
  "/",
  upload.any(),
  route(async (req, res, next) => {
    let payload;
    try {
      payload = JSON.parse(req.body.payload);
    } catch {
      return next(
        require("../utils/httpError")(400, "Invalid guided submission payload"),
      );
    }
    if ((req.files || []).some((file) => file.fieldname !== "attachments"))
      return next(
        require("../utils/httpError")(400, "Unexpected attachment field"),
      );
    const prepared = await service.prepare(pool, req.user.id, payload);
    req.guidedSubmission = { payload, body: prepared.body };
    req.body = prepared.body;
    req.user = prepared.user;
    return createRequest(req, res, next);
  }),
);
module.exports = router;
