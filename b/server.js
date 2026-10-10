const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const http = require("http");
const { Server } = require("socket.io");
const { verifySession } = require("./services/session");
require("dotenv").config({ path: require("path").join(__dirname, ".env"), quiet: true });
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error("Set JWT_SECRET to at least 32 random characters.");

const db = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const profileRoutes = require("./routes/profileRoutes");
const notificationRoutes = require("./routes/notificationRoutes");

const app = express();

const allowedOrigins = (process.env.CLIENT_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173").split(",").map(origin => origin.trim());

app.use(helmet());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.disable("x-powered-by");
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("X-NexTalk-Request") !== "1") {
    return res.status(403).json({ message: "Request verification failed." });
  }
  next();
});


app.get("/", (req, res) => {
  res.send("NexTalk backend is running");
});

app.get("/api", (req, res) => {
  res.json({
    message: "NexTalk API is running",
    endpoints: {
      health: "/",
      database: "/api/test-db",
      auth: {
        register: "POST /api/auth/register",
        login: "POST /api/auth/login",
        me: "GET /api/auth/me",
        logout: "POST /api/auth/logout",
      },
      users: {
        search: "GET /api/users/search?query=ali",
      },
      profiles: {
        view: "GET /api/profiles/:userId",
      },
      notifications: {
        list: "GET /api/notifications",
        read: "PATCH /api/notifications/:id/read",
      },
    },
  });
});

app.get("/api/test-db", async (req, res) => {
  res.status(404).json({ message: "Not found." });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/profiles", profileRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/chat", require("./routes/chatRoutes"));
app.use("/api/ai", require("./routes/aiRoutes"));
app.use("/api/media", require("./routes/mediaRoutes"));

const server = http.createServer(app);

const io = new Server(server, {
  maxHttpBufferSize: 16384,
  allowRequest(req, callback) {
    callback(null, !req.headers.origin || allowedOrigins.includes(req.headers.origin));
  },
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

global.io = io;
app.set("io", io);

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Socket auth token missing."));
    }

    const decoded = await verifySession(token, "nextalk-socket");
    const [users] = await db.execute("SELECT id FROM users WHERE id = ?", [decoded.id]);
    if (!users.length) return next(new Error("Account no longer exists."));
    socket.userId = decoded.id;
    socket.expiresAt = decoded.exp * 1000;
    socket.sessionId = decoded.sid;
    socket.authToken = token;

    next();
  } catch (error) {
    next(new Error("Invalid socket token."));
  }
});

io.on("connection", (socket) => {
  socket.join(`user:${socket.userId}`);
  socket.join(`session:${socket.sessionId}`);
  const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, socket.expiresAt - Date.now()));
  socket.on("message:send", async (payload, ack) => {
    if (typeof ack !== "function") return;
    try {
      if (Date.now() >= socket.expiresAt) return ack({ error: "Session expired. Please log in again." });
      await verifySession(socket.authToken, "nextalk-socket");
      const message = await require("./services/chat").sendMessage(socket.userId, payload, io);
      ack({ message });
    } catch (error) { ack({ error: error.status ? error.message : "Message could not be saved. Please retry." }); }
  });
  socket.on("disconnect", () => clearTimeout(expiry));
});

const PORT = process.env.PORT || 5000;

app.use((req, res) => res.status(404).json({ message: "Not found." }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  res.status(error.type === "entity.too.large" ? 413 : error instanceof SyntaxError ? 400 : 500)
    .json({ message: error instanceof SyntaxError ? "Invalid request body." : "Request could not be completed." });
});

if (require.main === module) server.listen(PORT, process.env.HOST || "127.0.0.1", () => {
  console.log(`NexTalk backend running on port ${PORT}`);
});
module.exports = { app, server, io };
