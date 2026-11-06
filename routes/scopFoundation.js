"use strict";
const express = require("express");
const requirePermission = require("../middleware/requirePermission");
const service = require("../services/scopFoundationService");
const router = express.Router();
router.use((_req, _res, next) => {
  try {
    service.requireEnabled();
    next();
  } catch (e) {
    next(e);
  }
});
const send = (work) => async (req, res, next) => {
  try {
    res.json({ success: true, data: await work(req) });
  } catch (e) {
    next(e);
  }
};
const item = "/requests/:requestId/items/:itemKind/:itemId";
// Fresh transactional authorization in the service also permits manage to read.
router.get(
  "/classifications",
  send((req) => service.classifications(req.user)),
);
router.get(
  item,
  send((req) => service.get(req.user, req.params)),
);
router.post(
  `${item}/classification`,
  requirePermission("scop.allocations.manage"),
  send((req) => service.command(req.user, req.params, "classify", req.body)),
);
router.post(
  `${item}/allocations`,
  requirePermission("scop.allocations.manage"),
  send((req) => service.command(req.user, req.params, "create", req.body)),
);
for (const action of ["reassign", "split", "cancel", "evidence", "close"])
  router.post(
    `${item}/allocations/:allocationId/${action}`,
    requirePermission("scop.allocations.manage"),
    send((req) => service.command(req.user, req.params, action, req.body)),
  );
module.exports = router;
