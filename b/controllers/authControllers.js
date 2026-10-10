const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { createSession, verifySession, requestToken } = require("../services/session");

async function sendToken(res, user, statusCode = 200) {
  const token = await createSession(user.id);

  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return res.status(statusCode).json({
    message: "Success",
    user,
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function register(req, res) {
  try {
    const { username, email, password, name } = req.body;

    if (![username, email, password, name].every(value => typeof value === "string" && value.trim())) {
      return res.status(400).json({ message: "All fields are required." });
    }

    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username.trim())) {
      return res.status(400).json({ message: "Username must be 3-30 letters, numbers, or underscores." });
    }

    if (email.trim().length > 254 || !isValidEmail(email.trim()) || name.trim().length > 100) {
      return res.status(400).json({ message: "Invalid email address." });
    }

    if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
      return res.status(400).json({ message: "Password must be at least 8 characters and at most 72 bytes." });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedUsername = username.toLowerCase().trim();

    const [existing] = await db.execute(
      `SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1`,
      [normalizedEmail, normalizedUsername]
    );

    if (existing.length > 0) {
      return res.status(409).json({ message: "Email or username already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [result] = await db.execute(
      `INSERT INTO users (username, email, password_hash, name, profile_name)
       VALUES (?, ?, ?, ?, ?)`,
      [
        normalizedUsername,
        normalizedEmail,
        passwordHash,
        name.trim(),
        name.trim(),
      ]
    );

    const user = {
      id: result.insertId,
      username: normalizedUsername,
      email: normalizedEmail,
      name: name.trim(),
      profile_name: name.trim(),
      profile_photo: null,
    };

    return res.status(201).json({ message: "Account created. Please log in.", user });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "Email or username already exists." });
    return res.status(500).json({ message: "Registration failed." });
  }
}

async function login(req, res) {
  try {
    const { emailOrUsername, password } = req.body;

    if (typeof emailOrUsername !== "string" || typeof password !== "string" || !emailOrUsername.trim() || !password) {
      return res.status(400).json({ message: "Email/username and password required." });
    }

    const loginValue = emailOrUsername.toLowerCase().trim();

    const [rows] = await db.execute(
      `SELECT id, username, email, password_hash, name, profile_name, profile_photo
       FROM users
       WHERE email = ? OR username = ?
       LIMIT 1`,
      [loginValue, loginValue]
    );

    const user = rows[0];

    if (!user) {
      return res.status(401).json({ message: "Invalid login credentials." });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid login credentials." });
    }

    delete user.password_hash;

    return await sendToken(res, user);
  } catch (error) {
    return res.status(500).json({ message: "Login failed." });
  }
}

async function me(req, res) {
  return res.json({
    message: "Authenticated user fetched.",
    user: req.user,
  });
}

async function logout(req, res) {
  try {
    const session = await verifySession(requestToken(req));
    await db.execute("DELETE FROM sessions WHERE id = ?", [session.sid]);
    req.app.get("io")?.in(`session:${session.sid}`).disconnectSockets(true);
  } catch (error) {
    if (error.status !== 401) return res.status(503).json({ message: "Logout could not be completed. Please retry." });
  }
  res.clearCookie("token", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
  return res.json({ message: "Logged out successfully." });
}

function socketToken(req, res) {
  const token = jwt.sign({ id: req.user.id, sid: req.session.sid }, process.env.JWT_SECRET, {
    algorithm: "HS256", audience: "nextalk-socket", expiresIn: "5m",
  });
  res.json({ token });
}

module.exports = {
  register,
  login,
  me,
  logout,
  socketToken,
};
