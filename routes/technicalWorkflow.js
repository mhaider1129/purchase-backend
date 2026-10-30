"use strict";
const express = require("express");
const pool = require("../config/db");
const profiles = require("../services/technicalReviewProfiles");
const delivery =
  require("../services/deliveryInspectionService").createDeliveryInspectionService(
    pool,
  );
const {
  createTransactionalP2PRepository,
} = require("../repositories/connectedP2PRepository");
const router = express.Router();
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
const transaction = async (work) => {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
};
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
router.get(
  "/profiles",
  wrap(async (req, res) => res.json(await profiles.directory(pool, req.user))),
);
router.put(
  "/profiles",
  wrap(async (req, res) =>
    res.json(await transaction((db) => profiles.save(db, req.user, req.body))),
  ),
);
router.get(
  "/receipt-options",
  wrap(async (req, res) => {
    if (
      !require("../services/deliveryInspectionService").permitted(
        req.user,
        "procure-to-pay.receipts.manage",
      )
    )
      throw Object.assign(new Error("Goods Receipt permission required"), {
        statusCode: 403,
      });
    res.json(
      (await profiles.installed(pool))
        ? (
            await pool.query(
              "SELECT profile_key FROM technical_review_profiles WHERE institute_id=$1 ORDER BY profile_key",
              [req.user.institute_id],
            )
          ).rows
        : [],
    );
  }),
);
router.post(
  "/generate",
  wrap(async (req, res) => {
    profiles.requireManager(req.user);
    await profiles.requireSchema(pool);
    if (!/^\d+$/.test(String(req.body.request_id)))
      throw Object.assign(new Error("Choose an approved request"), {
        statusCode: 400,
      });
    const row = (
      await pool.query(
        "SELECT id FROM requests WHERE id=$1 AND institute_id=$2",
        [req.body.request_id, req.user.institute_id],
      )
    ).rows[0];
    if (!row)
      throw Object.assign(new Error("Request not found"), { statusCode: 404 });
    res.json(
      await transaction((db) =>
        require("../services/technicalReviewAutomation").ensureRequiredReview(
          db,
          row.id,
        ),
      ),
    );
  }),
);
router.param("id", (req, res, next, id) =>
  /^\d+$/.test(id)
    ? next()
    : res.status(400).json({ message: "Invalid inspection ID" }),
);
router.get(
  "/delivery/:id",
  wrap(async (req, res) =>
    res.json(await delivery.get(req.user, req.params.id)),
  ),
);
for (const action of ["start", "opinion", "decide", "reopen"])
  router.post(
    `/delivery/:id/${action}`,
    wrap(async (req, res) =>
      res.json(await delivery[action](req.user, req.params.id, req.body)),
    ),
  );
router.post(
  "/delivery/:id/apply",
  wrap(async (req, res) =>
    res.json(
      await require("../services/goodsReceiptService").applyTechnicalDisposition(
        {
          repository: createTransactionalP2PRepository(pool),
          taskId: req.params.id,
          input: req.body,
          actor: req.user,
        },
      ),
    ),
  ),
);
module.exports = router;
