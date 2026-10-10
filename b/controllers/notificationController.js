const db = require("../config/db");
const { remember, deleteCache } = require("../utils/cache");

async function getNotifications(req, res) {
  try {
    const userId = Number(req.user.id);
    const before = req.query.before === undefined ? 4294967295 : Number(req.query.before);
    if (!Number.isSafeInteger(before) || before <= 0) return res.status(400).json({ message: "Invalid notification cursor." });
    const load = async () => {
      const [rows] = await db.execute(
        `SELECT
            n.id,
            n.type,
            n.title,
            n.message,
            n.reference_id,
            n.is_read,
            n.created_at,
            f.status AS friendship_status,
            f.requester_id,
            u.id AS actor_id,
            u.username AS actor_username,
            u.name AS actor_name,
            u.profile_name AS actor_profile_name,
            u.profile_photo AS actor_profile_photo
         FROM notifications n
         LEFT JOIN users u ON u.id = n.actor_id
         LEFT JOIN friendships f ON f.user_low = LEAST(n.user_id, n.actor_id) AND f.user_high = GREATEST(n.user_id, n.actor_id)
         WHERE n.user_id = ? AND n.id < ?
         ORDER BY n.id DESC
         LIMIT 51`,
        [userId, before]
      );

      return rows;
    };
    const rows = req.query.before ? await load() : await remember(`notifications:user:${userId}`, load);
    const notifications = rows.slice(0, 50);

    return res.json({
      message: "Notifications fetched successfully.",
      count: notifications.length,
      notifications,
      hasMore: rows.length > 50,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Notifications fetch failed.",
    });
  }
}

async function markNotificationRead(req, res) {
  try {
    const userId = Number(req.user.id);
    const notificationId = Number(req.params.id);

    if (!Number.isInteger(notificationId) || notificationId <= 0) {
      return res.status(400).json({ message: "Invalid notification id." });
    }

    const [result] = await db.execute(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE id = ? AND user_id = ?`,
      [notificationId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Notification not found." });
    }

    deleteCache(`notifications:user:${userId}`);
    req.app.get("io")?.to(`user:${userId}`).emit("notifications:changed");
    return res.json({ message: "Notification marked as read." });
  } catch (error) {
    return res.status(500).json({
      message: "Notification update failed.",
    });
  }
}

module.exports = {
  getNotifications,
  markNotificationRead,
};
