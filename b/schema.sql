CREATE DATABASE IF NOT EXISTS nextalk
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE nextalk;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(30) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  profile_name VARCHAR(100) NOT NULL,
  profile_photo VARCHAR(2048) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_username_unique (username),
  UNIQUE KEY users_email_unique (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS profile_views (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  viewer_id BIGINT UNSIGNED NOT NULL,
  viewed_user_id BIGINT UNSIGNED NOT NULL,
  viewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY profile_views_recent_idx (viewer_id, viewed_user_id, viewed_at),
  CONSTRAINT profile_views_viewer_fk
    FOREIGN KEY (viewer_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT profile_views_viewed_user_fk
    FOREIGN KEY (viewed_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  type VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  reference_id BIGINT UNSIGNED NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY notifications_user_created_idx (user_id, created_at),
  CONSTRAINT notifications_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT notifications_actor_fk
    FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT notifications_profile_view_fk
    FOREIGN KEY (reference_id) REFERENCES profile_views (id) ON DELETE SET NULL
) ENGINE=InnoDB;
