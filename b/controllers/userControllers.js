const db = require("../config/db");
const { remember } = require("../utils/cache");

function normalizeSearchQuery(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

async function searchUsers(req, res) {
  try {
    const query = normalizeSearchQuery(req.query.query);

    if (!query || query.length < 2) {
      return res.status(400).json({
        message: "Search query must be at least 2 characters.",
      });
    }

    if (query.length > 50) {
      return res.status(400).json({
        message: "Search query is too long.",
      });
    }

    const cacheKey = `users:search:${req.user.id}:${query}`;
    const users = await remember(cacheKey, async () => {
      const searchValue = `%${query}%`;

      const [rows] = await db.execute(
        `SELECT
            id,
            username,
            name,
            profile_name,
            profile_photo,
            created_at
         FROM users
         WHERE
            id != ?
            AND (
              username LIKE ?
              OR LOWER(name) LIKE ?
              OR LOWER(profile_name) LIKE ?
            )
         ORDER BY
            CASE
              WHEN username = ? THEN 1
              WHEN username LIKE ? THEN 2
              WHEN LOWER(name) LIKE ? THEN 3
              ELSE 4
            END,
            username ASC
         LIMIT 20`,
        [
          req.user.id,
          searchValue,
          searchValue,
          searchValue,
          query,
          `${query}%`,
          `${query}%`,
        ]
      );

      return rows;
    });

    return res.json({
      message: "Users fetched successfully.",
      count: users.length,
      users,
    });
  } catch (error) {
    return res.status(500).json({
      message: "User search failed.",
    });
  }
}

module.exports = {
  searchUsers,
};
