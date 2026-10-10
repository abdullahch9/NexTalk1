const express = require("express");
const rateLimit = require("express-rate-limit");

const { protect } = require("../middleware/authmiddleware");
const {
  getNotifications,
  markNotificationRead,
} = require("../controllers/notificationController");

const router = express.Router();

const notificationLimiter = rateLimit({
  windowMs: 60 * 1000, keyGenerator: req => String(req.user.id),
  max: 80,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many notification requests. Please slow down.",
  },
});

router.get("/", protect, notificationLimiter, getNotifications);
router.patch("/:id/read", protect, notificationLimiter, markNotificationRead);

module.exports = router;