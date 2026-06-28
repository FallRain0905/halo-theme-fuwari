import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import * as exifr from "exifr";
import Fastify from "fastify";
import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import initSqlJs from "sql.js";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const normalize = (value) => String(value ?? "").trim();
const trimSlash = (value) => normalize(value).replace(/\/+$/, "");

const config = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3300),
  adminEmail: process.env.PHOTO_ADMIN_EMAIL || "admin@123.com",
  adminPassword: process.env.PHOTO_ADMIN_PASSWORD || "admin123",
  dbPath: process.env.PHOTO_LIBRARY_DB || "/opt/photo-library/photo.db",
  sourceDir: process.env.PHOTO_LIBRARY_SOURCE || "/opt/photo-library/source",
  publicDir: process.env.PHOTO_LIBRARY_PUBLIC || "/opt/photo-library/public",
  publicBase: trimSlash(
    process.env.PHOTO_LIBRARY_PUBLIC_BASE || "/photo-library",
  ),
  maxFileSize: Number(process.env.PHOTO_MAX_FILE_SIZE || 100 * 1024 * 1024),
  sessionTtlMs: Number(
    process.env.PHOTO_SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000,
  ),
};

const acceptedExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);
const acceptedMime = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);
const sessions = new Map();

const now = () => new Date().toISOString();
const makeId = () => crypto.randomUUID().replace(/-/g, "");
const normalizePath = (value) => path.resolve(value || ".");
const isInside = (base, target) => {
  const rel = path.relative(normalizePath(base), normalizePath(target));
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
};
const publicUrl = (...parts) =>
  `${config.publicBase}/${parts.map((part) => encodeURIComponent(part)).join("/")}`;

const splitTags = (value) => {
  if (Array.isArray(value)) return value.map(normalize).filter(Boolean);
  return normalize(value)
    .split(/[#,，、\n]/)
    .map(normalize)
    .filter(Boolean)
    .filter((tag, index, list) => list.indexOf(tag) === index);
};

const formatDate = (value) => {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString();
  return normalize(value);
};

const parseCookie = (header = "") =>
  Object.fromEntries(
    String(header)
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index < 0) return [part, ""];
        return [
          part.slice(0, index),
          decodeURIComponent(part.slice(index + 1)),
        ];
      }),
  );

const clearExpiredSessions = () => {
  const timestamp = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (session.expiresAt <= timestamp) sessions.delete(id);
  }
};

const getSession = (request) => {
  clearExpiredSessions();
  const cookies = parseCookie(request.headers.cookie);
  const session = sessions.get(cookies.fallrain_photo_session);
  if (!session) return null;
  return session.expiresAt > Date.now() ? session : null;
};

const setSessionCookie = (reply, id) => {
  reply.header(
    "Set-Cookie",
    `fallrain_photo_session=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
      config.sessionTtlMs / 1000,
    )}`,
  );
};

const clearSessionCookie = (reply) => {
  reply.header(
    "Set-Cookie",
    "fallrain_photo_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
  );
};

const requireSession = async (request, reply) => {
  if (getSession(request)) return;
  return reply.code(401).send({ error: "Authentication required" });
};

const ensureDirs = async () => {
  await fs.mkdir(config.sourceDir, { recursive: true });
  await fs.mkdir(path.join(config.sourceDir, "originals"), { recursive: true });
  await fs.mkdir(path.join(config.publicDir, "photos", "large"), {
    recursive: true,
  });
  await fs.mkdir(path.join(config.publicDir, "photos", "thumb"), {
    recursive: true,
  });
};

const createDatabase = async () => {
  await fs.mkdir(path.dirname(config.dbPath), { recursive: true });
  const SQL = await initSqlJs();
  let db;
  try {
    db = new SQL.Database(await fs.readFile(config.dbPath));
  } catch {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      album TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      original_path TEXT NOT NULL,
      original_name TEXT NOT NULL DEFAULT '',
      mime TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      src TEXT NOT NULL,
      thumb TEXT NOT NULL,
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      taken_at TEXT NOT NULL DEFAULT '',
      camera TEXT NOT NULL DEFAULT '',
      lens TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_photos_album ON photos(album);
    CREATE INDEX IF NOT EXISTS idx_photos_taken_at ON photos(taken_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_photos_original_path ON photos(original_path);
  `);
  return db;
};

const persist = async (db) => {
  await fs.writeFile(config.dbPath, Buffer.from(db.export()));
};

const all = (db, sql, params = []) => {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
};

const get = (db, sql, params = []) => all(db, sql, params)[0] || null;

const run = (db, sql, params = []) => {
  const stmt = db.prepare(sql);
  try {
    stmt.run(params);
  } finally {
    stmt.free();
  }
};

const rowToPhoto = (row) => {
  let tags = [];
  try {
    tags = JSON.parse(row.tags_json || "[]");
  } catch {
    tags = [];
  }
  return {
    id: normalize(row.id),
    title: normalize(row.title),
    description: normalize(row.description),
    album: normalize(row.album),
    tags,
    src: normalize(row.src),
    thumb: normalize(row.thumb),
    width: Number(row.width) || 0,
    height: Number(row.height) || 0,
    takenAt: normalize(row.taken_at),
    camera: normalize(row.camera),
    lens: normalize(row.lens),
    createdAt: normalize(row.created_at),
    updatedAt: normalize(row.updated_at),
  };
};

const listPhotos = (db) =>
  all(
    db,
    `SELECT * FROM photos
     ORDER BY COALESCE(NULLIF(taken_at, ''), created_at) DESC, title COLLATE NOCASE`,
  ).map(rowToPhoto);

const aggregateLibrary = (photos) => {
  const albumMap = new Map();
  const tagMap = new Map();
  photos.forEach((photo) => {
    const album = photo.album || "未分类";
    albumMap.set(album, (albumMap.get(album) || 0) + 1);
    photo.tags.forEach((tag) => tagMap.set(tag, (tagMap.get(tag) || 0) + 1));
  });
  const byName = (a, b) => a.name.localeCompare(b.name, "zh-Hans-CN");
  return {
    albums: [...albumMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort(byName),
    tags: [...tagMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort(byName),
  };
};

const exportLibrary = async (db) => {
  await fs.mkdir(config.publicDir, { recursive: true });
  const photos = listPhotos(db);
  const aggregates = aggregateLibrary(photos);
  const payload = {
    generatedAt: now(),
    total: photos.length,
    publicBase: config.publicBase,
    ...aggregates,
    photos,
  };
  await fs.writeFile(
    path.join(config.publicDir, "photos.json"),
    JSON.stringify(payload, null, 2),
  );
  return payload;
};

const getExt = (filename, mimetype = "") => {
  const ext = path.extname(filename || "").toLowerCase();
  if (acceptedExts.has(ext)) return ext === ".jpeg" ? ".jpg" : ext;
  if (mimetype === "image/jpeg") return ".jpg";
  if (mimetype === "image/png") return ".png";
  if (mimetype === "image/webp") return ".webp";
  if (mimetype === "image/avif") return ".avif";
  return "";
};

const isImageFile = (file) =>
  acceptedExts.has(path.extname(file).toLowerCase());

const readExif = async (file) => {
  try {
    const data =
      (await exifr.parse(file, {
        tiff: true,
        ifd0: true,
        exif: true,
        gps: false,
        xmp: false,
        iptc: false,
      })) || {};
    return {
      takenAt: formatDate(
        data.DateTimeOriginal || data.CreateDate || data.ModifyDate,
      ),
      camera: [data.Make, data.Model].map(normalize).filter(Boolean).join(" "),
      lens: normalize(data.LensModel || data.Lens || data.LensInfo),
    };
  } catch {
    return { takenAt: "", camera: "", lens: "" };
  }
};

const createDerivatives = async (originalPath, id) => {
  const largePath = path.join(
    config.publicDir,
    "photos",
    "large",
    `${id}.webp`,
  );
  const thumbPath = path.join(
    config.publicDir,
    "photos",
    "thumb",
    `${id}.webp`,
  );
  const image = sharp(originalPath, { failOn: "none" }).rotate();

  await image
    .clone()
    .resize({
      width: 2400,
      height: 2400,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 84, effort: 5 })
    .toFile(largePath);

  await image
    .clone()
    .resize({
      width: 640,
      height: 640,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 78, effort: 4 })
    .toFile(thumbPath);

  const metadata = await sharp(largePath).metadata();
  return {
    src: publicUrl("photos", "large", `${id}.webp`),
    thumb: publicUrl("photos", "thumb", `${id}.webp`),
    width: Number(metadata.width) || 0,
    height: Number(metadata.height) || 0,
  };
};

const insertPhoto = async (db, photo) => {
  run(
    db,
    `INSERT INTO photos (
      id, title, description, album, tags_json, original_path, original_name,
      mime, size, src, thumb, width, height, taken_at, camera, lens, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      photo.id,
      photo.title,
      photo.description,
      photo.album,
      JSON.stringify(photo.tags),
      photo.originalPath,
      photo.originalName,
      photo.mime,
      photo.size,
      photo.src,
      photo.thumb,
      photo.width,
      photo.height,
      photo.takenAt,
      photo.camera,
      photo.lens,
      photo.createdAt,
      photo.updatedAt,
    ],
  );
};

const processImage = async (db, options) => {
  const id = options.id || makeId();
  const stat = await fs.stat(options.originalPath);
  const metadata = await sharp(options.originalPath).metadata();
  if (!metadata.format) throw new Error("Unsupported image file");

  const derivatives = await createDerivatives(options.originalPath, id);
  const exif = await readExif(options.originalPath);
  const timestamp = now();
  const photo = {
    id,
    title: normalize(options.title) || path.parse(options.originalName).name,
    description: normalize(options.description),
    album: normalize(options.album) || "未分类",
    tags: splitTags(options.tags),
    originalPath: path.resolve(options.originalPath),
    originalName: normalize(options.originalName),
    mime: normalize(options.mime) || `image/${metadata.format}`,
    size: stat.size,
    ...derivatives,
    takenAt: normalize(options.takenAt) || exif.takenAt,
    camera: normalize(options.camera) || exif.camera,
    lens: normalize(options.lens) || exif.lens,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await insertPhoto(db, photo);
  return photo;
};

const walkImages = async (dir) => {
  const result = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".incoming") continue;
      result.push(...(await walkImages(file)));
    } else if (entry.isFile() && isImageFile(file)) {
      result.push(file);
    }
  }
  return result;
};

const albumFromSourcePath = (file) => {
  const rel = path
    .relative(config.sourceDir, file)
    .split(path.sep)
    .filter(Boolean);
  if (rel.length > 1 && rel[0] !== "originals") return rel[0];
  return "未分类";
};

const syncSource = async (db) => {
  await ensureDirs();
  const known = new Set(
    all(db, "SELECT original_path FROM photos").map((row) =>
      path.resolve(row.original_path),
    ),
  );
  const files = await walkImages(config.sourceDir);
  let imported = 0;
  const errors = [];

  for (const file of files) {
    const resolved = path.resolve(file);
    if (known.has(resolved)) continue;
    try {
      await processImage(db, {
        originalPath: resolved,
        originalName: path.basename(file),
        album: albumFromSourcePath(file),
        tags: "",
      });
      imported += 1;
    } catch (error) {
      errors.push({ file, error: error.message });
    }
  }

  await persist(db);
  const library = await exportLibrary(db);
  return { imported, total: library.total, errors };
};

const saveUpload = async (part) => {
  const ext = getExt(part.filename, part.mimetype);
  if (!ext || !acceptedMime.has(part.mimetype)) {
    throw new Error(
      `Unsupported image type: ${part.filename || part.mimetype}`,
    );
  }
  const id = makeId();
  const date = new Date();
  const relDir = path.join(
    "originals",
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, "0"),
  );
  const targetDir = path.join(config.sourceDir, relDir);
  await fs.mkdir(targetDir, { recursive: true });
  const originalPath = path.join(targetDir, `${id}${ext}`);
  await pipeline(part.file, createWriteStream(originalPath));
  return { id, originalPath, originalName: part.filename, mime: part.mimetype };
};

const sendAdminFile = async (reply, filename, type) => {
  const file = path.join(apiDir, "admin", filename);
  reply.header("Content-Type", type);
  return reply.send(await fs.readFile(file, "utf8"));
};

await ensureDirs();
const db = await createDatabase();
try {
  await exportLibrary(db);
} catch (error) {
  console.warn(`Photo export skipped: ${error.message}`);
}

if (process.argv.includes("--sync-only")) {
  const result = await syncSource(db);
  console.log(`Synced ${result.total} photos (${result.imported} imported).`);
  db.close();
} else {
  const app = Fastify({
    logger: true,
    bodyLimit: config.maxFileSize + 1024 * 1024,
  });
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(multipart, {
    limits: {
      fileSize: config.maxFileSize,
      files: 50,
    },
  });

  app.get("/health", async () => ({
    ok: true,
    photos: get(db, "SELECT COUNT(*) AS count FROM photos")?.count || 0,
  }));

  app.get("/auth/me", async (request) => ({
    authenticated: Boolean(getSession(request)),
    email: getSession(request)?.email || "",
  }));

  app.post("/auth/login", async (request, reply) => {
    const email = normalize(request.body?.email);
    const password = normalize(request.body?.password);
    if (email !== config.adminEmail || password !== config.adminPassword) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }
    const id = crypto.randomBytes(32).toString("hex");
    sessions.set(id, { email, expiresAt: Date.now() + config.sessionTtlMs });
    setSessionCookie(reply, id);
    return { ok: true, email };
  });

  app.post("/auth/logout", async (request, reply) => {
    const cookies = parseCookie(request.headers.cookie);
    sessions.delete(cookies.fallrain_photo_session);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/photos", async () => exportLibrary(db));
  app.get("/export/photos.json", async () => exportLibrary(db));

  app.post("/sync", { preHandler: requireSession }, async () => ({
    ok: true,
    ...(await syncSource(db)),
  }));

  app.post(
    "/photos/upload",
    { preHandler: requireSession },
    async (request, reply) => {
      const fields = { title: "", description: "", album: "", tags: "" };
      const created = [];

      try {
        for await (const part of request.parts()) {
          if (part.type === "field") {
            if (part.fieldname in fields)
              fields[part.fieldname] = normalize(part.value);
            continue;
          }
          const saved = await saveUpload(part);
          const photo = await processImage(db, { ...saved, ...fields });
          created.push(
            rowToPhoto({
              ...photo,
              tags_json: JSON.stringify(photo.tags),
              original_path: photo.originalPath,
              original_name: photo.originalName,
              taken_at: photo.takenAt,
              created_at: photo.createdAt,
              updated_at: photo.updatedAt,
            }),
          );
        }
      } catch (error) {
        return reply.code(400).send({ error: error.message });
      }

      if (!created.length)
        return reply.code(400).send({ error: "No image files uploaded" });
      await persist(db);
      await exportLibrary(db);
      return { ok: true, photos: created };
    },
  );

  app.patch(
    "/photos/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const id = normalize(request.params.id);
      const existing = get(db, "SELECT id FROM photos WHERE id = ?", [id]);
      if (!existing) return reply.code(404).send({ error: "Photo not found" });

      const title = normalize(request.body?.title);
      const description = normalize(request.body?.description);
      const album = normalize(request.body?.album) || "未分类";
      const tags = splitTags(request.body?.tags);
      const timestamp = now();
      run(
        db,
        `UPDATE photos
       SET title = ?, description = ?, album = ?, tags_json = ?, updated_at = ?
       WHERE id = ?`,
        [title, description, album, JSON.stringify(tags), timestamp, id],
      );
      await persist(db);
      await exportLibrary(db);
      return { ok: true };
    },
  );

  app.delete(
    "/photos/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const id = normalize(request.params.id);
      const photo = get(db, "SELECT * FROM photos WHERE id = ?", [id]);
      if (!photo) return reply.code(404).send({ error: "Photo not found" });
      run(db, "DELETE FROM photos WHERE id = ?", [id]);
      await persist(db);

      const files = [
        normalize(photo.original_path),
        path.join(config.publicDir, "photos", "large", `${id}.webp`),
        path.join(config.publicDir, "photos", "thumb", `${id}.webp`),
      ];
      await Promise.all(
        files
          .filter(
            (file) =>
              file &&
              (isInside(config.sourceDir, file) ||
                isInside(config.publicDir, file)),
          )
          .map((file) => fs.rm(file, { force: true })),
      );
      await exportLibrary(db);
      return { ok: true };
    },
  );

  app.get("/admin", async (_request, reply) => reply.redirect("/admin/"));
  app.get("/admin/", async (_request, reply) =>
    sendAdminFile(reply, "index.html", "text/html; charset=utf-8"),
  );
  app.get("/admin/app.js", async (_request, reply) =>
    sendAdminFile(reply, "app.js", "text/javascript; charset=utf-8"),
  );
  app.get("/admin/styles.css", async (_request, reply) =>
    sendAdminFile(reply, "styles.css", "text/css; charset=utf-8"),
  );

  await app.listen({ host: config.host, port: config.port });
}
