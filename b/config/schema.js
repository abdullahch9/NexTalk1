const statements = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(30) NOT NULL UNIQUE,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    profile_name VARCHAR(100), profile_photo TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id CHAR(64) PRIMARY KEY, user_id INT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL, INDEX user_sessions (user_id), INDEX expiry (expires_at)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS media (
    id VARCHAR(64) PRIMARY KEY, user_id INT UNSIGNED NOT NULL,
    mime VARCHAR(50) NOT NULL, size INT UNSIGNED NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX owner_media (user_id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS profile_views (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    viewer_id INT UNSIGNED NOT NULL, viewed_user_id INT UNSIGNED NOT NULL,
    viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX recent_views (viewer_id, viewed_user_id, viewed_at)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL, actor_id INT UNSIGNED,
    type VARCHAR(40) NOT NULL, title VARCHAR(255) NOT NULL, message TEXT NOT NULL,
    reference_id INT UNSIGNED, is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX user_notifications (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS friendships (
    user_low INT UNSIGNED NOT NULL, user_high INT UNSIGNED NOT NULL,
    requester_id INT UNSIGNED NOT NULL,
    status ENUM('pending','accepted') NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_low, user_high), INDEX friend_high (user_high, status)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sender_id INT UNSIGNED NOT NULL, recipient_id INT UNSIGNED NOT NULL,
    client_id VARCHAR(64) NOT NULL, body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY delivery (sender_id, client_id),
    INDEX conversation (sender_id, recipient_id, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

async function setupSchema(connection) {
  for (const sql of statements) await connection.query(sql);
  const [columns] = await connection.query("SHOW COLUMNS FROM users");
  const existing = new Set(columns.map(column => column.Field));
  for (const [name, type] of Object.entries({ bio: "VARCHAR(1000)", banner: "VARCHAR(255)", song_url: "VARCHAR(255)", song_title: "VARCHAR(100)" })) {
    if (!existing.has(name)) await connection.query(`ALTER TABLE users ADD COLUMN ${name} ${type} NULL`);
  }
  // Restore existing pending requests to the durable activity feed on upgrade.
  await connection.query(`INSERT INTO notifications (user_id, actor_id, type, title, message, reference_id, created_at)
    SELECT IF(f.requester_id = f.user_low, f.user_high, f.user_low), f.requester_id,
      'friend_request', 'New friend request', CONCAT(u.name, ' wants to connect with you.'), NULL, f.created_at
    FROM friendships f JOIN users u ON u.id = f.requester_id
    WHERE f.status = 'pending' AND NOT EXISTS (
      SELECT 1 FROM notifications n WHERE n.type = 'friend_request' AND n.actor_id = f.requester_id
      AND n.user_id = IF(f.requester_id = f.user_low, f.user_high, f.user_low))`);
}
module.exports = { setupSchema };
