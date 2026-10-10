const { verifySession, requestToken } = require("../services/session");
const db = require("../config/db");
const { remember } = require("../utils/cache");
const { protectTraffic } = require("./traffic");

async function protect(req, res, next) {
  try {
    const token = requestToken(req);

    if (!token) {
      return res.status(401).json({ message: "Not authorized. Token missing." });
    }

    const decoded = await verifySession(token);
    req.session = decoded;

    const cacheKey = `auth:user:${decoded.id}`;
    const user = await remember(cacheKey, async () => {
      const [rows] = await db.execute(
        `SELECT id, username, email, name, profile_name, profile_photo, created_at
         FROM users
         WHERE id = ?
         LIMIT 1`,
        [decoded.id]
      );

      return rows[0] || null;
    });

    if (!user) {
      return res.status(401).json({ message: "User no longer exists." });
    }

    req.user = user;
    protectTraffic(req, res, next);
  } catch (error) {
    if (error.status !== 401) {
      return res.status(503).json({ message: "Account service unavailable. Please try again shortly." });
    }
    return res.status(401).json({ message: "Not authorized. Invalid token." });
  }
}

module.exports = { protect };
