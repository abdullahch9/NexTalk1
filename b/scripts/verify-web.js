// Optional end-to-end check against a running frontend and backend.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const db = require("../config/db");
const base = process.env.SITE_URL || "http://127.0.0.1:3000";
const accounts = [];
async function request(path, cookie, method = "GET", body, origin = base) {
  const response = await fetch(`${base}${path}`, { method, redirect: "manual", headers: {
    "Content-Type": "application/json", "X-NexTalk-Request": "1", Origin: origin, ...(cookie ? { Cookie: cookie } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  return response;
}
async function main() {
  try {
    for (const path of ["/home", "/chat", "/chatai", "/search", "/notifications", "/profile"]) {
      const response = await request(path);
      assert.equal(response.status, 307, `Anonymous ${path}`); assert.match(response.headers.get("location"), /\/login$/);
    }
    assert.equal((await request("/api/chat/friends")).status, 401);
    assert.equal((await request("/api/auth/register", null, "POST", {}, "https://untrusted.example")).status, 403);
    const suffix = randomUUID().slice(0, 8);
    for (const label of ["a", "b"]) {
      const username = `webqa_${suffix}_${label}`;
      const password = randomUUID();
      const registration = await request("/api/auth/register", null, "POST", { username, email: `${username}@example.test`, password, name: `Web QA ${label}` });
      assert.equal(registration.status, 201); assert.equal(registration.headers.get("set-cookie"), null);
      const user = (await registration.json()).user;
      accounts.push(user);
      const login = await request("/api/auth/login", null, "POST", { emailOrUsername: username, password });
      assert.equal(login.status, 200); assert.match(login.headers.get("set-cookie"), /HttpOnly/i);
      user.cookie = login.headers.get("set-cookie").split(";")[0];
      assert.equal((await login.json()).token, undefined);
    }
    const [a, b] = accounts;
    assert.equal((await request(`/api/chat/friends/${b.id}`, a.cookie, "POST")).status, 200);
    assert.equal((await request(`/api/chat/friends/${a.id}/accept`, b.cookie, "POST")).status, 200);
    const home = await request("/home", a.cookie);
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    const html = await home.text();
    assert.ok(html.includes("Web QA b"), "Friend should be present in the initial SSR HTML");
    assert.ok(!html.includes(a.cookie.slice(6)), "Session token must not be serialized");
    const payload = { recipientId: b.id, text: "BFF smoke message", clientId: randomUUID() };
    assert.equal((await request("/api/chat/messages", a.cookie, "POST", payload)).status, 201);
    const history = await (await request(`/api/chat/messages/${a.id}`, b.cookie)).json();
    assert.equal(history.messages[0].body, payload.text);
    const changed = await request("/api/profiles/me", a.cookie, "PATCH", { name: "Web QA updated", bio: "Server-rendered profile" });
    assert.equal(changed.status, 200);
    const profile = await request(`/profile/${a.id}`, a.cookie);
    assert.ok((await profile.text()).includes("Server-rendered profile"));
    assert.equal((await request("/api/auth/logout", a.cookie, "POST")).status, 200);
    assert.equal((await request("/api/auth/me", a.cookie)).status, 401);
    console.log("Web smoke passed: protected SSR routes, same-origin API, HttpOnly login, friendships, persistence, profile update, logout.");
  } finally {
    for (const user of accounts) {
      for (const [table, clause] of [["messages", "sender_id = ? OR recipient_id = ?"], ["friendships", "user_low = ? OR user_high = ?"], ["notifications", "user_id = ? OR actor_id = ?"], ["profile_views", "viewer_id = ? OR viewed_user_id = ?"]]) {
        await db.execute(`DELETE FROM ${table} WHERE ${clause}`, [user.id, user.id]);
      }
      await db.execute("DELETE FROM sessions WHERE user_id = ?", [user.id]);
      await db.execute("DELETE FROM users WHERE id = ? AND username = ?", [user.id, user.username]);
    }
    await db.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
