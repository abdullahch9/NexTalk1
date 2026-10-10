const rateLimit = require("express-rate-limit");

// Authenticated quotas belong to accounts, not the shared frontend proxy IP.
const accountLimiter = rateLimit({
  windowMs: 60_000, limit: 240,
  keyGenerator: req => String(req.user.id),
  standardHeaders: true, legacyHeaders: false,
  message: { message: "Too many requests. Please wait a moment." },
});
const cooldowns = new Map();
const timer = setInterval(() => {
  for (const [key, until] of cooldowns) if (until <= Date.now()) cooldowns.delete(key);
}, 2000);
timer.unref();

function mutationCooldown(req, res, next) {
  // Reads, session recovery/logout, and idempotent message delivery stay immediate.
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || req.baseUrl === "/api/auth" || req.baseUrl === "/api/chat" && req.path === "/messages") return next();
  const key = `${req.user.id}:${req.method}:${req.baseUrl}${req.path}`;
  const remaining = (cooldowns.get(key) || 0) - Date.now();
  if (remaining > 0) {
    res.set("Retry-After", String(Math.ceil(remaining / 1000)));
    return res.status(429).json({ code: "COOLDOWN", retryAfterMs: remaining, message: "Please wait two seconds before repeating this action." });
  }
  const until = Date.now() + 2000;
  cooldowns.set(key, until);
  res.once("finish", () => {
    // Validation failures can be corrected immediately.
    if (res.statusCode >= 400 && cooldowns.get(key) === until) cooldowns.delete(key);
  });
  next();
}

function protectTraffic(req, res, next) {
  accountLimiter(req, res, () => mutationCooldown(req, res, next));
}
module.exports = { protectTraffic, mutationCooldown };
