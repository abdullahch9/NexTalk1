const { test, after, before, mock } = require("node:test");
const { Responses } = require("openai/resources/responses/responses");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
require("dotenv").config({ path: require("path").join(__dirname, "../.env"), quiet: true });
const db = require("../config/db");
const { server, io } = require("../server");
const { io: client } = require("../../f/node_modules/socket.io-client");
let base;
const users = [];
const sockets = [];
const suffix = randomUUID().slice(0, 8);
const password = "Test-password-492!";
const waitForCooldown = () => new Promise(resolve => setTimeout(resolve, 2050));
async function request(path, token, method = "GET", body, cookie) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", "X-NexTalk-Request": "1", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, cookie: response.headers.get("set-cookie"), data: await response.json() };
}
before(async () => { await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => {
  sockets.forEach(socket => socket.disconnect());
  await new Promise(resolve => io.close(resolve));
  for (const user of users) {
    const [uploads] = await db.execute("SELECT id FROM media WHERE user_id = ?", [user.id]);
    for (const upload of uploads) {
      assert.match(upload.id, /^[a-f0-9-]{36}\.(webp|mp3|ogg|wav)$/);
      await fs.unlink(path.join(__dirname, "../storage/media", upload.id)).catch(() => {});
    }
    await db.execute("DELETE FROM media WHERE user_id = ?", [user.id]);
    await db.execute("DELETE FROM notifications WHERE user_id = ? OR actor_id = ?", [user.id, user.id]);
    await db.execute("DELETE FROM profile_views WHERE viewer_id = ? OR viewed_user_id = ?", [user.id, user.id]);
    await db.execute("DELETE FROM messages WHERE sender_id = ? OR recipient_id = ?", [user.id, user.id]);
    await db.execute("DELETE FROM friendships WHERE user_low = ? OR user_high = ?", [user.id, user.id]);
    await db.execute("DELETE FROM users WHERE id = ? AND username = ?", [user.id, user.username]);
    await db.execute("DELETE FROM sessions WHERE user_id = ?", [user.id]);
  }
  await db.end();
});

test("registration, duplicate protection, authenticated friendship and real socket messaging", async t => {
  await t.test("registration returns no session; login validates credentials", async () => {
    for (const label of ["a", "b", "c"]) {
      const username = `qa_${suffix}_${label}`;
      const result = await request("/api/auth/register", null, "POST", { username, email: `${username}@example.test`, name: `QA ${label}`, password });
      assert.equal(result.status, 201);
      users.push(result.data.user);
      assert.equal(result.data.token, undefined);
      assert.equal(result.cookie, null);
      const login = await request("/api/auth/login", null, "POST", { emailOrUsername: username, password });
      assert.equal(login.status, 200);
      assert.equal(login.data.token, undefined);
      assert.match(login.cookie, /HttpOnly/i);
      users.at(-1).token = decodeURIComponent(login.cookie.match(/token=([^;]+)/)[1]);
    }
    assert.equal((await request("/api/auth/login", null, "POST", { emailOrUsername: users[0].username, password: "incorrect" })).status, 401);
    assert.equal((await request("/api/auth/register", null, "POST", { username: "   ", email: "invalid", password, name: "Test" })).status, 400);
  });
  await t.test("normalized username and email are each unique", async () => {
    const first = users[0];
    for (const fields of [
      { username: first.username.toUpperCase(), email: `other_${suffix}@example.test` },
      { username: `other_${suffix}`, email: ` ${first.email.toUpperCase()} ` },
    ]) assert.equal((await request("/api/auth/register", null, "POST", { ...fields, name: "Duplicate", password })).status, 409);
  });
  await t.test("concurrent registrations cannot create duplicate usernames or emails", async () => {
    const username = `qa_${suffix}_race`;
    const body = { username, email: `${username}@example.test`, name: "Concurrent QA", password };
    const results = await Promise.all([request("/api/auth/register", null, "POST", body), request("/api/auth/register", null, "POST", body)]);
    for (const result of results) if (result.status === 201) users.push(result.data.user);
    assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  });
  await t.test("bearer session takes precedence over stale cookies; private APIs require auth", async () => {
    const me = await request("/api/auth/me", users[0].token, "GET", undefined, "token=expired");
    assert.equal(me.status, 200); assert.equal(me.data.user.id, users[0].id);
    assert.equal((await request("/api/chat/friends")).status, 401);
    assert.equal((await request("/api/ai/chat", null, "POST", { messages: [] })).status, 401);
  });
  await t.test("only recipient can accept; only accepted friends can send or read messages", async () => {
    const [a, b, c] = users;
    const payload = { recipientId: b.id, text: "Hello", clientId: randomUUID() };
    assert.equal((await request("/api/chat/messages", a.token, "POST", payload)).status, 403);
    assert.equal((await request(`/api/chat/friends/${b.id}`, a.token, "POST")).status, 200);
    const notices = await request("/api/notifications", b.token);
    const notice = notices.data.notifications.find(item => item.type === "friend_request" && item.actor_id === a.id);
    assert.ok(notice); assert.equal(notice.friendship_status, "pending");
    assert.equal((await request(`/api/notifications/${notice.id}/read`, c.token, "PATCH")).status, 404);
    assert.equal((await request(`/api/notifications/${notice.id}/read`, b.token, "PATCH")).status, 200);
    const read = (await request("/api/notifications", b.token)).data.notifications.find(item => item.id === notice.id);
    assert.equal(read.is_read, 1);
    const limited = await request(`/api/chat/friends/${b.id}`, a.token, "POST");
    assert.equal(limited.status, 429); assert.equal(limited.data.code, "COOLDOWN");
    assert.equal((await request(`/api/chat/friends/${b.id}/accept`, a.token, "POST")).status, 404);
    assert.equal((await request(`/api/chat/friends/${a.id}/accept`, b.token, "POST")).status, 200);
    const accepted = (await request("/api/notifications", b.token)).data.notifications.find(item => item.id === notice.id);
    assert.equal(accepted.friendship_status, "accepted"); assert.equal(accepted.is_read, 1);
    assert.ok((await request("/api/notifications", a.token)).data.notifications.some(item => item.type === "friend_accepted"));
    await waitForCooldown();
    assert.equal((await request(`/api/chat/friends/${b.id}`, a.token, "POST")).status, 200);
    assert.equal((await request("/api/notifications", b.token)).data.notifications.filter(item => item.type === "friend_request" && item.actor_id === a.id).length, 1);
    assert.equal((await request(`/api/chat/messages/${a.id}`, c.token)).status, 403);
  });
  await t.test("WebSocket delivers to recipient, retries deduplicate, history survives reconnect", async () => {
    const [a, b] = users;
    async function connect(token) {
      const ticket = await request("/api/auth/socket-token", token);
      const socket = client(base, { auth: { token: ticket.data.token }, transports: ["websocket"], reconnection: false });
      sockets.push(socket);
      await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
      return socket;
    }
    const sender = await connect(a.token);
    const recipient = await connect(b.token);
    const payload = { recipientId: b.id, text: "Live message ✓", clientId: randomUUID() };
    const delivered = new Promise(resolve => recipient.once("message:new", resolve));
    const ack = await sender.timeout(3000).emitWithAck("message:send", payload);
    assert.equal(ack.message.body, payload.text);
    assert.equal((await delivered).id, ack.message.id);
    const retry = await request("/api/chat/messages", a.token, "POST", payload);
    assert.equal(retry.data.message.id, ack.message.id);
    assert.equal((await request("/api/chat/messages", a.token, "POST", { ...payload, text: "changed" })).status, 409);
    recipient.disconnect();
    const history = await request(`/api/chat/messages/${a.id}`, b.token);
    assert.equal(history.data.messages.length, 1);
    assert.equal(history.data.messages[0].body, payload.text);
    const denied = await connect(users[2].token);
    const denial = await denied.timeout(3000).emitWithAck("message:send", { ...payload, clientId: randomUUID() });
    assert.match(denial.error, /friend/);
    const bad = client(base, { auth: { token: "invalid" }, transports: ["websocket"], reconnection: false });
    sockets.push(bad);
    assert.match((await new Promise(resolve => bad.once("connect_error", resolve))).message, /token/i);
  });
  await t.test("AI request validation rejects invalid input before calling provider", async () => {
    assert.equal((await request("/api/ai/chat", users[0].token, "POST", { messages: [{ role: "system", content: "bad" }] })).status, 400);
  });
  await t.test("profiles and uploaded media enforce ownership, type validation, private drafts, and audio range delivery", async () => {
    const [a, b] = users;
    const headers = { Authorization: `Bearer ${a.token}`, "X-NexTalk-Request": "1" };
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#23594b" } }).png().toBuffer();
    const upload = await fetch(`${base}/api/media`, { method: "POST", headers: { ...headers, "Content-Type": "image/png" }, body: png });
    assert.equal(upload.status, 201);
    const { url } = await upload.json();
    assert.equal((await fetch(`${base}${url}`)).status, 401);
    assert.equal((await fetch(`${base}${url}`, { headers: { Authorization: `Bearer ${b.token}` } })).status, 404);
    const own = await fetch(`${base}${url}`, { headers });
    assert.equal(own.status, 200);
    const metadata = await sharp(Buffer.from(await own.arrayBuffer())).metadata();
    assert.equal(metadata.format, "webp"); assert.equal(metadata.exif, undefined);
    const invalidUpload = await fetch(`${base}/api/media`, { method: "POST", headers: { ...headers, "Content-Type": "image/png" }, body: Buffer.from('<svg onload="alert(1)"></svg>') });
    assert.equal(invalidUpload.status, 429);
    await waitForCooldown();
    const invalidAfterCooldown = await fetch(`${base}/api/media`, { method: "POST", headers: { ...headers, "Content-Type": "image/png" }, body: Buffer.from('<svg onload="alert(1)"></svg>') });
    assert.equal(invalidAfterCooldown.status, 400);
    assert.equal((await request("/api/profiles/me", b.token, "PATCH", { name: "QA b", profile_photo: url })).status, 400);
    assert.equal((await request("/api/profiles/me", a.token, "PATCH", { name: "QA a", banner: "https://attacker.example/track.png" })).status, 400);
    const saved = await request("/api/profiles/me", a.token, "PATCH", { name: "QA updated", bio: "Hello from the integration test", profile_photo: url, banner: url, id: b.id });
    assert.equal(saved.status, 200); assert.equal(saved.data.profile.id, a.id);
    const viewed = await request(`/api/profiles/${a.id}`, b.token);
    assert.equal(viewed.data.profile.bio, "Hello from the integration test");
    assert.equal(viewed.data.profile.email, undefined); assert.equal(viewed.data.profile.password_hash, undefined);
    assert.equal((await fetch(`${base}${url}`, { headers: { Authorization: `Bearer ${b.token}` } })).status, 200);
    const bProfile = await request(`/api/profiles/${b.id}`, b.token);
    assert.equal(bProfile.data.profile.name, "QA b");
    const wav = Buffer.alloc(244);
    wav.write("RIFF", 0); wav.writeUInt32LE(236, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(200, 40);
    const audioUpload = await fetch(`${base}/api/media`, { method: "POST", headers: { ...headers, "Content-Type": "audio/wav" }, body: wav });
    assert.equal(audioUpload.status, 201);
    const audioUrl = (await audioUpload.json()).url;
    const range = await fetch(`${base}${audioUrl}`, { headers: { ...headers, Range: "bytes=0-15" } });
    assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 16);
    await waitForCooldown();
    assert.equal((await request("/api/profiles/me", a.token, "PATCH", { name: "QA updated", song_url: audioUrl, song_title: "Test song" })).status, 200);
    assert.equal((await request(url, a.token, "DELETE")).status, 200);
    assert.equal((await fetch(`${base}${url}`, { headers })).status, 404);
  });
  await t.test("Rizzler rejects non-friends and oversized snippets before contacting AI", async () => {
    assert.equal((await request("/api/ai/rizzler", users[2].token, "POST", { friendId: users[0].id, tone: "sweet", message: "hello" })).status, 403);
    assert.equal((await request("/api/ai/rizzler", users[0].token, "POST", { friendId: users[1].id, tone: "sweet", message: "a".repeat(1001) })).status, 400);
  });
  await t.test("AI response contracts and quota errors work with an explicit mocked provider", async () => {
    let captured;
    const method = mock.method(Responses.prototype, "create", async input => {
      captured = input;
      if (input.text) return { output_text: JSON.stringify({ suggestions: ["Better now that you said hi.", "Good, with room for one more smile.", "Tell me the highlight of yours?"] }) };
      return { output_text: "A sourced answer.", output: [{ type: "message", content: [{ type: "output_text", text: "A sourced answer.", annotations: [{ type: "url_citation", url: "https://example.com/source", title: "Source", start_index: 0, end_index: 16 }] }] }] };
    });
    try {
      const suggestions = await request("/api/ai/rizzler", users[0].token, "POST", { friendId: users[1].id, tone: "sweet", message: "How was your day?" });
      assert.equal(suggestions.status, 200); assert.equal(suggestions.data.suggestions.length, 3);
      assert.deepEqual(JSON.parse(captured.input), { tone: "sweet", snippet: "How was your day?" });
      assert.equal(captured.store, false);
      const answer = await request("/api/ai/chat", users[0].token, "POST", { messages: [{ role: "user", content: "Find a source" }] });
      assert.equal(answer.status, 200); assert.equal(answer.data.sources[0].url, "https://example.com/source");
      assert.equal(captured.tools[0].type, "web_search"); assert.equal(captured.tool_choice, "required");
      method.mock.mockImplementation(async () => { throw Object.assign(new Error("Provider unavailable"), { status: 429, code: "credit_balance_exhausted" }); });
      await waitForCooldown();
      const quota = await request("/api/ai/chat", users[0].token, "POST", { messages: [{ role: "user", content: "Find a source" }] });
      assert.equal(quota.status, 429); assert.match(quota.data.message, /credits are exhausted/i);
    } finally { method.mock.restore(); }
  });
  await t.test("CSRF and logout revocation protect both HTTP and sockets", async () => {
    const response = await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 403);
    const ticket = (await request("/api/auth/socket-token", users[0].token)).data.token;
    assert.equal((await request("/api/auth/logout", users[0].token, "POST")).status, 200);
    assert.equal((await request("/api/auth/me", users[0].token)).status, 401);
    const revoked = client(base, { auth: { token: ticket }, transports: ["websocket"], reconnection: false });
    sockets.push(revoked);
    assert.match((await new Promise(resolve => revoked.once("connect_error", resolve))).message, /token/i);
  });
});
