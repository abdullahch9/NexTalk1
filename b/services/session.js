const jwt = require("jsonwebtoken");
const { randomBytes } = require("node:crypto");
const db = require("../config/db");
const unauthorized = () => Object.assign(new Error("Please log in again."), { status: 401 });

async function createSession(userId) {
  const sid = randomBytes(32).toString("hex");
  await db.execute("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))", [sid, userId]);
  return jwt.sign({ id: userId, sid }, process.env.JWT_SECRET, { algorithm: "HS256", audience: "nextalk", expiresIn: "7d" });
}

async function verifySession(token, audience = "nextalk") {
  let decoded;
  try { decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"], audience }); }
  catch { throw unauthorized(); }
  if (!Number.isSafeInteger(decoded.id) || typeof decoded.sid !== "string") throw unauthorized();
  const [rows] = await db.execute("SELECT user_id FROM sessions WHERE id = ? AND user_id = ? AND expires_at > NOW()", [decoded.sid, decoded.id]);
  if (!rows.length) throw unauthorized();
  return decoded;
}

function requestToken(req) {
  const bearer = req.headers.authorization;
  return bearer?.startsWith("Bearer ") ? bearer.slice(7) : req.cookies?.token;
}
module.exports = { createSession, verifySession, requestToken };
