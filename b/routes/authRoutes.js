const express = require("express");
const rateLimit = require("express-rate-limit");

const {
  register,
  login,
  me,
  logout,
  socketToken,
} = require("../controllers/authControllers");

const { protect } = require("../middleware/authmiddleware");

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many attempts. Please try again later.",
  },
});

router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.get("/me", protect, me);
router.post("/logout", logout);
router.get("/socket-token", protect, socketToken);

module.exports = router;
