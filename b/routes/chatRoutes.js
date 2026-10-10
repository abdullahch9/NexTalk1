const express = require("express");
const rateLimit = require("express-rate-limit");
const db = require("../config/db");
const { protect } = require("../middleware/authmiddleware");
const { userId, pair, requireFriend, sendMessage } = require("../services/chat");
const { remember, deleteCache } = require("../utils/cache");
const router = express.Router();
router.use(protect);
const route = (handler) => async (req, res) => {
  try { await handler(req, res); }
  catch (error) { res.status(error.status || 503).json({ message: error.status ? error.message : "Messaging service unavailable. Please retry." }); }
};

router.get("/friends", route(async (req, res) => {
  const friends = await remember(`friends:${req.user.id}`, async () => {
  const [rows] = await db.execute(`SELECT u.id, u.name, u.username, u.profile_photo, f.status, f.requester_id
    FROM friendships f JOIN users u ON u.id = IF(f.user_low = ?, f.user_high, f.user_low)
    WHERE f.user_low = ? OR f.user_high = ? ORDER BY u.name`, [req.user.id, req.user.id, req.user.id]);
  return rows;
  });
  res.json({ friends });
}));
router.post("/friends/:id", route(async (req, res) => {
  const id = userId(req.params.id);
  if (id === Number(req.user.id)) return res.status(400).json({ message: "You cannot add yourself." });
  const [users] = await db.execute("SELECT id FROM users WHERE id = ?", [id]);
  if (!users.length) return res.status(404).json({ message: "User not found." });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(`INSERT IGNORE INTO friendships (user_low, user_high, requester_id) VALUES (?, ?, ?)`, [...pair(id, req.user.id), req.user.id]);
    if (result.affectedRows) await connection.execute(`INSERT INTO notifications (user_id, actor_id, type, title, message) VALUES (?, ?, 'friend_request', 'New friend request', ?)`, [id, req.user.id, `${req.user.name || req.user.username} wants to connect with you.`]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  friendshipChanged(req, id);
  res.json({ message: "Friend request saved." });
}));
router.post("/friends/:id/accept", route(async (req, res) => {
  const id = userId(req.params.id);
  const connection = await db.getConnection();
  try {
  await connection.beginTransaction();
  const [result] = await connection.execute(`UPDATE friendships SET status = 'accepted'
    WHERE user_low = ? AND user_high = ? AND requester_id = ? AND status = 'pending'`, [...pair(id, req.user.id), id]);
  if (!result.affectedRows) { await connection.rollback(); return res.status(404).json({ message: "Incoming request not found." }); }
  await connection.execute(`INSERT INTO notifications (user_id, actor_id, type, title, message) VALUES (?, ?, 'friend_accepted', 'Friend request accepted', ?)`, [id, req.user.id, `${req.user.name || req.user.username} accepted your request. You can now chat.`]);
  await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  friendshipChanged(req, id);
  res.json({ message: "Friend added. You can now message each other." });
}));
router.get("/messages/:id", route(async (req, res) => {
  const id = userId(req.params.id);
  await requireFriend(req.user.id, id);
  const before = req.query.before ? userId(req.query.before) : 4294967295;
  const [messages] = await db.execute(`SELECT * FROM messages WHERE id < ? AND
    ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
    ORDER BY id DESC LIMIT 50`, [before, req.user.id, id, id, req.user.id]);
  res.json({ messages: messages.reverse(), hasMore: messages.length === 50 });
}));
router.post("/messages", rateLimit({ windowMs: 60000, limit: 60, keyGenerator: req => String(req.user.id), message: { message: "Please slow down." } }), route(async (req, res) => {
  res.status(201).json({ message: await sendMessage(req.user.id, req.body, req.app.get("io")) });
}));
module.exports = router;

function friendshipChanged(req, otherId) {
  for (const id of [otherId, req.user.id]) {
    deleteCache(`friends:${id}`);
    deleteCache(`notifications:user:${id}`);
    req.app.get("io")?.to(`user:${id}`).emit("friends:changed");
    req.app.get("io")?.to(`user:${id}`).emit("notifications:changed");
  }
}
