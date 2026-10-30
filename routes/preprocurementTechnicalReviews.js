"use strict";
const express = require("express");
const pool = require("../config/db");
const {
  createTechnicalReviewService,
} = require("../services/preprocurementTechnicalReviewService");
const {
  CHECKLIST,
  ASSESSMENT,
  CATEGORIES,
  canManage,
} = require("../services/preprocurementTechnicalReviewModel");
const service = createTechnicalReviewService(pool);
const router = express.Router();
router.param("id", (req, res, next, id) =>
  /^\d+$/.test(id)
    ? next()
    : res.status(400).json({ message: "Invalid technical review ID" }),
);
const wrap = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res)).catch(next);
router.get(
  "/schema",
  wrap(async (req, res) =>
    res.json({
      checklist: CHECKLIST,
      assessment: ASSESSMENT,
      extra_assessment_choices: require("../services/technicalReviewProfiles")
        .DELIVERY_CHECKS,
      workflow_available:
        await require("../services/technicalReviewProfiles").installed(pool),
      categories: CATEGORIES,
      can_manage: canManage(req.user),
      form_reference: "DPP.SC.001.F07",
    }),
  ),
);
router.get(
  "/proposals",
  wrap(async (req, res) => {
    require("../services/technicalReviewProfiles").requireManager(req.user);
    res.json({
      quotations: (
        await pool.query(
          "SELECT q.id,q.requested_item_id,ri.item_name,rr.supplier_id,s.name supplier_name FROM rfx_response_items q JOIN rfx_responses rr ON rr.id=q.rfx_response_id JOIN requested_items ri ON ri.id=q.requested_item_id JOIN requests r ON r.id=ri.request_id JOIN suppliers s ON s.id=rr.supplier_id WHERE r.institute_id=$1 AND rr.request_id=r.id ORDER BY q.id DESC LIMIT 1000",
          [req.user.institute_id],
        )
      ).rows,
      suppliers: (
        await pool.query(
          "SELECT id,name FROM suppliers WHERE (institute_id=$1 OR institute_id IS NULL) AND lower(COALESCE(status,'')) NOT IN ('inactive','suspended','blacklisted') ORDER BY name",
          [req.user.institute_id],
        )
      ).rows,
      products: (
        await pool.query(
          "SELECT id,product_name FROM approved_products WHERE institute_id=$1 AND is_active ORDER BY product_name",
          [req.user.institute_id],
        )
      ).rows,
    });
  }),
);
router.get(
  "/policy",
  wrap(async (req, res) => res.json(await service.policy(req.user))),
);
router.put(
  "/policy",
  wrap(async (req, res) =>
    res.json(await service.updatePolicy(req.user, req.body)),
  ),
);
router.get(
  "/reviewers",
  wrap(async (req, res) => res.json(await service.directory(req.user))),
);
router.get(
  "/eligible-requests",
  wrap(async (req, res) =>
    res.json(await service.eligible(req.user, req.query.search)),
  ),
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
router.post(
  "/:id/opinion",
  wrap(async (req, res) =>
    res.json(await service.opinion(req.user, req.params.id, req.body)),
  ),
);
router.post(
  "/:id/sign-off",
  wrap(async (req, res) =>
    res.json(await service.sign(req.user, req.params.id, req.body)),
  ),
);
router.post(
  "/:id/cancel",
  wrap(async (req, res) =>
    res.json(await service.cancel(req.user, req.params.id, req.body)),
  ),
);
router.post(
  "/:id/revise",
  wrap(async (req, res) =>
    res.json(await service.revise(req.user, req.params.id, req.body)),
  ),
);
router.post(
  "/:id/start",
  wrap(async (req, res) =>
    res.json(await service.start(req.user, req.params.id, req.body)),
  ),
);
module.exports = router;
