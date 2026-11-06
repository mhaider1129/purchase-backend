const express = require("express");
const {
  listNotifications,
  markAsRead,
  markManyAsRead,
  markAllAsRead,
} = require("../controllers/notificationsController");

const router = express.Router();

router.get(
  "/operations",
  require("../middleware/requirePermission")("operations.events.view"),
  async (req, res, next) => {
    try {
      res.json(
        await require("../services/eventReconciliationService").forActor(
          req.user,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);
router.get("/", listNotifications);
router.patch("/read-all", markAllAsRead);
router.patch("/read-many", markManyAsRead);
router.patch("/:id/read", markAsRead);

module.exports = router;
