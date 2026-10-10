const express = require("express");
const rateLimit = require("express-rate-limit");

const { protect } = require("../middleware/authmiddleware");
const { getPublicProfile, updateProfile } = require("../controllers/profileController");

const router = express.Router();

const profileLimiter = rateLimit({
  windowMs: 60 * 1000, keyGenerator: req => String(req.user.id),
  max: 80,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many profile requests. Please slow down.",
  },
});

router.get("/:userId", protect, profileLimiter, getPublicProfile);
router.patch("/me", protect, profileLimiter, updateProfile);

module.exports = router;
