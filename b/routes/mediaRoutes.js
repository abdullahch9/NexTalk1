const express = require("express");
const rateLimit = require("express-rate-limit");
const sharp = require("sharp");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const db = require("../config/db");
const { protect } = require("../middleware/authmiddleware");
const router = express.Router();
const storage = path.join(__dirname, "../storage/media");
const types = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav" };
const validId = /^[a-f0-9-]{36}\.(webp|mp3|ogg|wav)$/;
router.use(protect);

function validAudio(bytes, extension) {
  if (extension === "mp3") return bytes.subarray(0, 3).toString() === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (extension === "ogg") return bytes.subarray(0, 4).toString() === "OggS" && (bytes.subarray(0, 100).includes(Buffer.from("OpusHead")) || bytes.subarray(0, 100).includes(Buffer.from("vorbis")));
  return bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WAVE";
}

router.post("/", rateLimit({ windowMs: 60000, limit: 12, keyGenerator: req => String(req.user.id), message: { message: "Please wait before uploading more files." } }), express.raw({ type: Object.keys(types), limit: "6mb" }), async (req, res) => {
  let filename;
  let connection;
  try {
    let mime = req.get("Content-Type")?.split(";")[0];
    let extension = types[mime];
    let bytes = req.body;
    if (!extension || !Buffer.isBuffer(bytes) || !bytes.length) return res.status(400).json({ message: "Choose a JPG, PNG, WebP, MP3, Ogg, or WAV file." });
    if (mime.startsWith("image/")) {
      if (bytes.length > 2 * 1024 * 1024) return res.status(413).json({ message: "Images must be 2 MB or smaller." });
      try {
        const image = sharp(bytes, { limitInputPixels: 16000000, animated: false });
        const metadata = await image.metadata();
        if (!["jpeg", "png", "webp"].includes(metadata.format)) throw new Error("Invalid image");
        bytes = await image.rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
        mime = "image/webp"; extension = "webp";
      } catch { return res.status(400).json({ message: "This image cannot be read. Choose a valid JPG, PNG, or WebP under 16 megapixels." }); }
    } else if (!validAudio(bytes, extension)) return res.status(400).json({ message: "The audio contents do not match a supported format." });
    if (mime === "audio/x-wav") mime = "audio/wav";
    connection = await db.getConnection();
    await connection.beginTransaction();
    await connection.execute("SELECT id FROM users WHERE id = ? FOR UPDATE", [req.user.id]);
    const [sizes] = await connection.execute("SELECT COALESCE(SUM(size), 0) AS total FROM media WHERE user_id = ?", [req.user.id]);
    if (Number(sizes[0].total) + bytes.length > 32 * 1024 * 1024) {
      await connection.rollback();
      return res.status(413).json({ message: "Your 32 MB media allowance is full. Remove unused uploads before adding more." });
    }
    const id = `${randomUUID()}.${extension}`;
    filename = path.join(storage, id);
    await fs.mkdir(storage, { recursive: true });
    await fs.writeFile(filename, bytes, { flag: "wx" });
    await connection.execute("INSERT INTO media (id, user_id, mime, size) VALUES (?, ?, ?, ?)", [id, req.user.id, mime, bytes.length]);
    await connection.commit();
    res.status(201).json({ url: `/api/media/${id}` });
  } catch {
    if (connection) await connection.rollback().catch(() => {});
    if (filename) await fs.unlink(filename).catch(() => {});
    res.status(503).json({ message: "Upload could not be saved. Please try again." });
  } finally { connection?.release(); }
});

router.get("/:id", async (req, res) => {
  if (!validId.test(req.params.id)) return res.status(404).json({ message: "File not found." });
  try {
    const [rows] = await db.execute(`SELECT m.mime FROM media m WHERE m.id = ? AND
      (m.user_id = ? OR EXISTS (SELECT 1 FROM users u WHERE u.profile_photo = ? OR u.banner = ? OR u.song_url = ?))`,
      [req.params.id, req.user.id, ...Array(3).fill(`/api/media/${req.params.id}`)]);
    if (!rows.length) return res.status(404).json({ message: "File not found." });
    res.type(rows[0].mime);
    res.set("Content-Disposition", "inline");
    res.sendFile(path.join(storage, req.params.id), { cacheControl: false }, error => {
      if (error && !res.headersSent) res.status(404).json({ message: "File not found." });
    });
  } catch { res.status(503).json({ message: "Media is temporarily unavailable." }); }
});

router.delete("/:id", async (req, res) => {
  if (!validId.test(req.params.id)) return res.status(404).json({ message: "File not found." });
  const url = `/api/media/${req.params.id}`;
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    await connection.execute("SELECT id FROM users WHERE id = ? FOR UPDATE", [req.user.id]);
    const [owned] = await connection.execute("SELECT id FROM media WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
    if (!owned.length) { await connection.rollback(); return res.status(404).json({ message: "File not found." }); }
    const [used] = await connection.execute("SELECT id FROM users WHERE profile_photo = ? OR banner = ? OR song_url = ? LIMIT 1", [url, url, url]);
    if (used.length) { await connection.rollback(); return res.status(409).json({ message: "Remove this file from your profile before deleting it." }); }
    const [result] = await connection.execute("DELETE FROM media WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
    if (!result.affectedRows) { await connection.rollback(); return res.status(404).json({ message: "File not found." }); }
    await connection.commit();
    await fs.unlink(path.join(storage, req.params.id)).catch(() => {});
    res.json({ message: "Upload removed." });
  } catch {
    await connection?.rollback().catch(() => {});
    res.status(503).json({ message: "Could not remove upload." });
  } finally { connection?.release(); }
});
module.exports = router;
