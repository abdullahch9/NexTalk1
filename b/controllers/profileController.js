const db = require("../config/db");
const { deleteCache, remember } = require("../utils/cache");

async function getPublicProfile(req, res) {
  try {
    const viewerId = Number(req.user.id);
    const viewedUserId = Number(req.params.userId);

    if (!Number.isInteger(viewedUserId) || viewedUserId <= 0) {
      return res.status(400).json({ message: "Invalid profile id." });
    }

    const cacheKey = `profile:public:${viewedUserId}`;
    const profile = await remember(cacheKey, async () => {
        const [rows] = await db.execute(
          `SELECT
              id,
              username,
              name,
              profile_name,
              profile_photo,
              banner, bio, song_url, song_title,
              created_at
           FROM users
           WHERE id = ?
           LIMIT 1`,
          [viewedUserId]
        );

        return rows[0] || null;
      });

    if (!profile) {
      return res.status(404).json({ message: "Profile not found." });
    }

    if (viewerId !== viewedUserId) {
      await recordProfileView({
        viewerId,
        viewedUserId,
        viewerName: req.user.profile_name || req.user.name || req.user.username,
      });
    }

    return res.json({
      message: "Profile fetched successfully.",
      profile,
    });
  } catch (error) {
    return res.status(500).json({ message: "Profile fetch failed." });
  }
}

async function recordProfileView({ viewerId, viewedUserId, viewerName }) {
  const [recentViews] = await db.execute(
    `SELECT id
     FROM profile_views
     WHERE viewer_id = ?
       AND viewed_user_id = ?
       AND viewed_at >= DATE_SUB(NOW(), INTERVAL 10 SECOND)
     LIMIT 1`,
    [viewerId, viewedUserId]
  );

  if (recentViews.length > 0) {
    return;
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [viewResult] = await connection.execute(
      `INSERT INTO profile_views (viewer_id, viewed_user_id)
       VALUES (?, ?)`,
      [viewerId, viewedUserId]
    );

    const [notificationResult] = await connection.execute(
      `INSERT INTO notifications
        (user_id, actor_id, type, title, message, reference_id)
       VALUES
        (?, ?, 'profile_view', ?, ?, ?)`,
      [
        viewedUserId,
        viewerId,
        "New profile view",
        `${viewerName} viewed your profile.`,
        viewResult.insertId,
      ]
    );

    await connection.commit();
    deleteCache(`notifications:user:${viewedUserId}`);

    if (global.io) {
      global.io.to(`user:${viewedUserId}`).emit("notification:new", {
        id: notificationResult.insertId,
        type: "profile_view",
        title: "New profile view",
        message: `${viewerName} viewed your profile.`,
        actor_id: viewerId,
        reference_id: viewResult.insertId,
        created_at: new Date().toISOString(),
      });
    }
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  getPublicProfile,
  updateProfile,
};

async function updateProfile(req, res) {
  const { name, bio = "", profile_photo = null, banner = null, song_url = null, song_title = "" } = req.body;
  if (typeof name !== "string" || !name.trim() || name.trim().length > 100 || typeof bio !== "string" || bio.length > 1000 || typeof song_title !== "string" || song_title.length > 100) {
    return res.status(400).json({ message: "Add a name (up to 100 characters), bio (up to 1,000), and song title (up to 100)." });
  }
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    await connection.execute("SELECT id FROM users WHERE id = ? FOR UPDATE", [req.user.id]);
    for (const [url, type] of [[profile_photo, "image/"], [banner, "image/"], [song_url, "audio/"]]) {
      if (url === null || url === "") continue;
      if (typeof url !== "string" || !/^\/api\/media\/[a-f0-9-]{36}\.(webp|mp3|ogg|wav)$/.test(url)) {
        await connection.rollback(); return res.status(400).json({ message: "Use a file uploaded to NexTalk." });
      }
      const [media] = await connection.execute("SELECT mime FROM media WHERE id = ? AND user_id = ?", [url.split("/").at(-1), req.user.id]);
      if (!media[0]?.mime.startsWith(type)) { await connection.rollback(); return res.status(400).json({ message: "This upload is unavailable or belongs to another account." }); }
    }
    await connection.execute("UPDATE users SET name = ?, profile_name = ?, bio = ?, profile_photo = ?, banner = ?, song_url = ?, song_title = ? WHERE id = ?",
      [name.trim(), name.trim(), bio.trim(), profile_photo || null, banner || null, song_url || null, song_url ? song_title.trim() : null, req.user.id]);
    await connection.commit();
    deleteCache(`profile:public:${req.user.id}`);
    deleteCache(`auth:user:${req.user.id}`);
    const [profiles] = await db.execute("SELECT id, username, name, profile_name, profile_photo, banner, bio, song_url, song_title, created_at FROM users WHERE id = ?", [req.user.id]);
    res.json({ profile: profiles[0] });
  } catch { await connection?.rollback().catch(() => {}); res.status(503).json({ message: "Profile could not be saved. Your changes are still in the form." }); }
  finally { connection?.release(); }
}
