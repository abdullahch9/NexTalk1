const db = require("../config/db");
const messageWindows = new Map();
const cleanup = setInterval(() => {
  for (const [id, window] of messageWindows) if (window.until <= Date.now()) messageWindows.delete(id);
}, 60_000);
cleanup.unref();

function checkMessageRate(id) {
  let window = messageWindows.get(id);
  if (!window || window.until <= Date.now()) {
    window = { until: Date.now() + 60_000, count: 0 };
    messageWindows.set(id, window);
  }
  if (++window.count > 60) throw Object.assign(new Error("Please wait a minute before sending more messages."), { status: 429 });
}

function userId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw Object.assign(new Error("Invalid user."), { status: 400 });
  return id;
}
const pair = (a, b) => [Math.min(a, b), Math.max(a, b)];

async function requireFriend(senderId, recipientId) {
  const [rows] = await db.execute("SELECT status FROM friendships WHERE user_low = ? AND user_high = ?", pair(senderId, recipientId));
  if (rows[0]?.status !== "accepted") throw Object.assign(new Error("Add this friend and wait for them to accept before messaging."), { status: 403 });
}

async function sendMessage(senderId, payload, io) {
  checkMessageRate(senderId);
  const recipientId = userId(payload?.recipientId);
  const text = payload?.text;
  const clientId = payload?.clientId;
  if (typeof text !== "string" || !text.trim() || text.length > 4000 || typeof clientId !== "string" || !/^[\w-]{1,64}$/.test(clientId)) {
    throw Object.assign(new Error("A message (up to 4,000 characters) and delivery ID are required."), { status: 400 });
  }
  await requireFriend(senderId, recipientId);
  await db.execute(`INSERT INTO messages (sender_id, recipient_id, client_id, body) VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`, [senderId, recipientId, clientId, text.trim()]);
  const [rows] = await db.execute("SELECT * FROM messages WHERE sender_id = ? AND client_id = ?", [senderId, clientId]);
  const message = rows[0];
  if (Number(message.recipient_id) !== recipientId || message.body !== text.trim()) {
    throw Object.assign(new Error("Delivery ID already used for another message."), { status: 409 });
  }
  io?.to(`user:${senderId}`).to(`user:${recipientId}`).emit("message:new", message);
  return message;
}
module.exports = { userId, pair, requireFriend, sendMessage };
