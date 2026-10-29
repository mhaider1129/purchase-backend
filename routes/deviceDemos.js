"use strict";
const express = require("express");
const pool = require("../config/db");
const { createDeviceDemoService } = require("../services/deviceDemoService");
const m = require("../services/deviceDemoModel");
const router = express.Router(),
  service = createDeviceDemoService(pool);
const wrap = (handler) => (req, res, next) =>
  Promise.resolve()
    .then(() => handler(req, res))
    .catch(next);
router.param("id", (req, res, next, value) => {
  try {
    m.id(value);
    next();
  } catch (e) {
    next(e);
  }
});
router.get(
  "/schema",
  wrap(async (req, res) =>
    res.json({
      can_initiate: m.initiator(req.user) && !m.isCoo(req.user),
      can_coo: m.isCoo(req.user),
      criteria: m.DEFAULT_CRITERIA,
    }),
  ),
);
router.get(
  "/eligible-items",
  wrap(async (req, res) =>
    res.json(await service.eligible(req.user, req.query.search)),
  ),
);
router.get(
  "/reviewers",
  wrap(async (req, res) => res.json(await service.directory(req.user))),
);
router.get(
  "/",
  wrap(async (req, res) =>
    res.json(await service.list(req.user, req.query.search)),
  ),
);
router.post(
  "/",
  wrap(async (req, res) =>
    res.status(201).json(await service.create(req.user, req.body)),
  ),
);
router.get(
  "/:id",
  wrap(async (req, res) =>
    res.json(await service.get(req.user, req.params.id)),
  ),
);
router.get(
  "/:id/options",
  wrap(async (req, res) =>
    res.json(await service.options(req.user, req.params.id)),
  ),
);
for (const action of [
  "document",
  "candidate",
  "transition",
  "observation",
  "opinion",
  "recommend",
  "decision",
  "cancel",
  "return",
])
  router.post(
    `/:id/${action}`,
    wrap(async (req, res) =>
      res.json(await service.mutate(req.user, req.params.id, req.body, action)),
    ),
  );
module.exports = router;
