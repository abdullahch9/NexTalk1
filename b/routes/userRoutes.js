const express = require("express");
const rateLimit = require("express-rate-limit");

const { protect } = require("../middleware/authmiddleware");
const { searchUsers } = require("../controllers/userControllers");

const router = express.Router();

const searchLimiter = rateLimit({
  windowMs: 60 * 1000, keyGenerator: req => String(req.user.id),
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many search requests. Please slow down.",
  },
});

router.get("/search", protect, searchLimiter, searchUsers);

module.exports = router;