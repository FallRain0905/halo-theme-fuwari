import cors from "@fastify/cors";
import Fastify from "fastify";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const defaultSongsJson = path.join(
  rootDir,
  "public/assets/music/library/songs.json",
);

const config = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3100),
  token: process.env.MUSIC_API_TOKEN || "",
  dbPath: process.env.MUSIC_API_DB || path.join(rootDir, "music-library.db"),
  songsJson: process.env.MUSIC_LIBRARY_JSON || defaultSongsJson,
  musicSource: process.env.MUSIC_LIBRARY_SOURCE || "/opt/music-library/source",
  publicOutput:
    process.env.MUSIC_LIBRARY_PUBLIC_OUTPUT ||
    path.dirname(process.env.MUSIC_LIBRARY_JSON || defaultSongsJson),
  publicBase: process.env.MUSIC_LIBRARY_PUBLIC_BASE || "/music-library",
  downloadTtlMs: Number(
    process.env.MUSIC_IMPORT_DOWNLOAD_TTL_MS || 30 * 60 * 1000,
  ),
};

const normalize = (value) => String(value ?? "").trim();

const toSong = (item, index) => ({
  id: normalize(item.id) || `song-${index}`,
  title: normalize(item.title || item.name) || `Track ${index + 1}`,
  artist: normalize(item.artist || item.author) || "Unknown Artist",
  album: normalize(item.album) || "Unknown Album",
  category: normalize(item.category || item.section || item.genre),
  track: Number(item.track) || 0,
  cover: normalize(item.cover || item.pic),
  url: normalize(item.url || item.src),
  lrc: normalize(item.lrc || item.lyric),
  duration: normalize(item.duration),
});

const now = () => new Date().toISOString();

const readJsonFile = async (file) => {
  const raw = await fs.readFile(file, "utf8");
  const data = JSON.parse(raw);
  return Array.isArray(data)
    ? data
    : Array.isArray(data?.songs)
      ? data.songs
      : [];
};

const createDatabase = async () => {
  const SQL = await initSqlJs();
  let db;
  try {
    const data = await fs.readFile(config.dbPath);
    db = new SQL.Database(data);
  } catch {
    db = new SQL.Database();
  }

  db.run(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      track INTEGER NOT NULL DEFAULT 0,
      cover TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL,
      lrc TEXT NOT NULL DEFAULT '',
      duration TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS favorites (
      song_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlist_songs (
      playlist_id TEXT NOT NULL,
      song_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY(playlist_id, song_id),
      FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id TEXT NOT NULL,
      played_at TEXT NOT NULL,
      position_seconds REAL NOT NULL DEFAULT 0,
      FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS play_stats (
      song_id TEXT PRIMARY KEY,
      plays INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      last_played_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wishlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);

  return db;
};

const persist = async (db) => {
  await fs.mkdir(path.dirname(config.dbPath), { recursive: true });
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

const syncSongs = async (db) => {
  const source = await readJsonFile(config.songsJson);
  const songs = source.map(toSong).filter((song) => song.url);
  const timestamp = now();

  db.run("BEGIN");
  try {
    const stmt = db.prepare(`
      INSERT INTO songs (
        id, title, artist, album, category, track, cover, url, lrc, duration, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        artist = excluded.artist,
        album = excluded.album,
        category = excluded.category,
        track = excluded.track,
        cover = excluded.cover,
        url = excluded.url,
        lrc = excluded.lrc,
        duration = excluded.duration,
        updated_at = excluded.updated_at
    `);
    try {
      songs.forEach((song) => {
        stmt.run([
          song.id,
          song.title,
          song.artist,
          song.album,
          song.category,
          song.track,
          song.cover,
          song.url,
          song.lrc,
          song.duration,
          timestamp,
        ]);
      });
    } finally {
      stmt.free();
    }
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }

  await persist(db);
  return songs.length;
};

const requireToken = async (request, reply) => {
  if (!config.token) return;
  const header = request.headers.authorization || "";
  if (header !== `Bearer ${config.token}`) {
    await reply.code(401).send({ error: "Unauthorized" });
  }
};

const isAuthorized = (request) => {
  if (!config.token) return true;
  return request.headers.authorization === `Bearer ${config.token}`;
};

const makeId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const importJobs = new Map();

const appendJobLog = (job, text) => {
  job.log += text;
  if (job.log.length > 200000) job.log = job.log.slice(-160000);
};

const publicJob = (job) => ({
  id: job.id,
  type: job.type,
  mode: job.mode,
  status: job.status,
  code: job.code,
  startedAt: job.startedAt,
  finishedAt: job.finishedAt,
  expiresAt: job.expiresAt,
  category: job.category,
  itemCount: job.itemCount,
  songs: job.songs,
  downloadUrl: job.downloadUrl,
  error: job.error,
  log: job.log,
});

const parseImportItems = (value) =>
  String(value || "")
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

const hasRunningImport = () =>
  [...importJobs.values()].some((job) => job.status === "running");

const runProcess = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => options.onData?.(chunk));
    child.stderr.on("data", (chunk) => options.onData?.(chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });

const zipDirectory = async (sourceDir, zipFile, job) => {
  await fs.mkdir(path.dirname(zipFile), { recursive: true });
  appendJobLog(job, `\nCreating ZIP package: ${zipFile}\n`);
  const zipArgs = ["-m", "zipfile", "-c", zipFile, "."];
  await runProcess("python3", zipArgs, {
    cwd: sourceDir,
    onData: (chunk) => appendJobLog(job, chunk),
  }).catch(async (error) => {
    appendJobLog(job, `python3 zip failed: ${error.message}\n`);
    await runProcess("python", zipArgs, {
      cwd: sourceDir,
      onData: (chunk) => appendJobLog(job, chunk),
    });
  });
};

const startBilibiliImport = async (payload) => {
  if (hasRunningImport()) {
    const running = [...importJobs.values()].find(
      (job) => job.status === "running",
    );
    const error = new Error("Another import job is already running.");
    error.runningJob = running;
    throw error;
  }

  const items = parseImportItems(payload?.items || payload?.url || payload?.bv);
  if (!items.length) {
    const error = new Error("At least one Bilibili BV id or URL is required.");
    error.statusCode = 400;
    throw error;
  }

  const id = makeId();
  const timestamp = now();
  const mode = normalize(payload?.mode) === "library" ? "library" : "download";
  const tempDir = path.join(rootDir, ".tmp", "bili-imports", id);
  const inputFile = path.join(tempDir, "items.txt");
  const downloadOutput = path.join(tempDir, "source");
  const zipPath = path.join(tempDir, "bilibili-audio.zip");
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(inputFile, `${items.join("\n")}\n`, "utf8");

  const job = {
    id,
    type: "bilibili",
    mode,
    status: "running",
    code: null,
    startedAt: timestamp,
    finishedAt: "",
    expiresAt: "",
    category: normalize(payload?.category) || "Bilibili",
    itemCount: items.length,
    songs: 0,
    downloadUrl: "",
    zipPath: "",
    error: "",
    log: "",
    tempDir,
  };
  importJobs.set(id, job);

  const script = path.join(rootDir, "scripts", "download-bili-audio.mjs");
  const args = [
    script,
    "--input",
    inputFile,
    "--output",
    mode === "download"
      ? downloadOutput
      : normalize(payload?.output) || config.musicSource,
    "--category",
    job.category,
    "--format",
    normalize(payload?.format) || "mp3",
  ];

  if (mode === "library") {
    args.push(
      "--generate",
      "--public-output",
      normalize(payload?.publicOutput) || config.publicOutput,
      "--public-base",
      normalize(payload?.publicBase) || config.publicBase,
      "--generate-input",
      normalize(payload?.generateInput) || config.musicSource,
      "--category-depth",
      String(Number(payload?.categoryDepth) || 1),
    );
  }

  if (payload?.playlist) args.push("--playlist");
  if (payload?.playlistItems)
    args.push("--playlist-items", normalize(payload.playlistItems));
  if (payload?.flatCategory) args.push("--flat-category");
  if (payload?.overwrite) args.push("--overwrite");
  if (payload?.cleanPublic) args.push("--clean-public");
  if (payload?.cookies) args.push("--cookies", normalize(payload.cookies));
  if (payload?.cookiesFromBrowser)
    args.push("--cookies-from-browser", normalize(payload.cookiesFromBrowser));
  if (payload?.proxy) args.push("--proxy", normalize(payload.proxy));
  if (payload?.ytDlp) args.push("--yt-dlp", normalize(payload.ytDlp));
  if (payload?.ffmpegLocation)
    args.push("--ffmpeg-location", normalize(payload.ffmpegLocation));

  appendJobLog(job, `Import mode: ${mode}\n`);
  appendJobLog(
    job,
    mode === "download"
      ? "Output: temporary ZIP package, music library will not be changed.\n"
      : "Output: add generated audio to the shared music library.\n",
  );
  appendJobLog(
    job,
    `node ${args.map((arg) => JSON.stringify(arg)).join(" ")}\n\n`,
  );

  const child = spawn(process.execPath, args, {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => appendJobLog(job, chunk));
  child.stderr.on("data", (chunk) => appendJobLog(job, chunk));
  child.on("error", async (error) => {
    job.status = "failed";
    job.error = error.message;
    job.finishedAt = now();
    appendJobLog(job, `\n${error.message}\n`);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });
  child.on("exit", async (code) => {
    job.code = code;
    job.finishedAt = now();
    if (code === 0) {
      try {
        if (mode === "download") {
          await zipDirectory(downloadOutput, zipPath, job);
          await fs
            .rm(downloadOutput, { recursive: true, force: true })
            .catch(() => {});
          job.zipPath = zipPath;
          job.downloadUrl = `/imports/${encodeURIComponent(job.id)}/download`;
          job.expiresAt = new Date(
            Date.now() + config.downloadTtlMs,
          ).toISOString();
          windowCleanupImport(job.id, config.downloadTtlMs);
        } else {
          job.songs = await syncSongs(db);
          appendJobLog(job, `\nSynced ${job.songs} songs into music-api.\n`);
        }
        job.status = "done";
      } catch (error) {
        job.status = "failed";
        job.error = error.message;
        appendJobLog(job, `\nSync failed: ${error.message}\n`);
      }
    } else {
      job.status = "failed";
      job.error = `Process exited with code ${code}.`;
      appendJobLog(job, `\nProcess exited with code ${code}.\n`);
    }
    if (job.status !== "done" || mode !== "download") {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  return job;
};

const windowCleanupImport = (jobId, delay) => {
  setTimeout(
    async () => {
      const job = importJobs.get(jobId);
      if (!job || job.status !== "done" || job.mode !== "download") return;
      await fs
        .rm(job.tempDir, { recursive: true, force: true })
        .catch(() => {});
      job.downloadUrl = "";
      job.zipPath = "";
      job.error = "Download package expired.";
    },
    Math.max(60000, delay),
  );
};

const db = await createDatabase();
try {
  const count = await syncSongs(db);
  console.log(`Synced ${count} songs from ${config.songsJson}`);
} catch (error) {
  console.warn(`Song sync skipped: ${error.message}`);
}

if (process.argv.includes("--sync-only")) {
  db.close();
} else {
  const app = Fastify({ logger: true });
  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
  });

  app.get("/health", async () => ({
    ok: true,
    songs: get(db, "SELECT COUNT(*) AS count FROM songs")?.count || 0,
  }));

  app.post("/sync", { preHandler: requireToken }, async () => {
    const count = await syncSongs(db);
    return { ok: true, songs: count };
  });

  app.get("/songs", async (request) => {
    const q = normalize(request.query.q).toLowerCase();
    const rows = all(
      db,
      `SELECT id, title, artist, album, category, track, cover, url, lrc, duration
       FROM songs
       ORDER BY category COLLATE NOCASE, artist COLLATE NOCASE, album COLLATE NOCASE, track, title COLLATE NOCASE`,
    );
    if (!q) return { songs: rows };
    return {
      songs: rows.filter((song) =>
        `${song.title} ${song.artist} ${song.album} ${song.category}`
          .toLowerCase()
          .includes(q),
      ),
    };
  });

  app.get("/favorites", { preHandler: requireToken }, async () => ({
    songs: all(
      db,
      `SELECT songs.*
       FROM favorites
       JOIN songs ON songs.id = favorites.song_id
       ORDER BY favorites.created_at DESC`,
    ),
  }));

  app.post(
    "/favorites/:songId",
    { preHandler: requireToken },
    async (request, reply) => {
      const songId = normalize(request.params.songId);
      if (!get(db, "SELECT id FROM songs WHERE id = ?", [songId])) {
        return reply.code(404).send({ error: "Song not found" });
      }
      run(
        db,
        "INSERT OR IGNORE INTO favorites (song_id, created_at) VALUES (?, ?)",
        [songId, now()],
      );
      await persist(db);
      return { ok: true };
    },
  );

  app.delete(
    "/favorites/:songId",
    { preHandler: requireToken },
    async (request) => {
      run(db, "DELETE FROM favorites WHERE song_id = ?", [
        normalize(request.params.songId),
      ]);
      await persist(db);
      return { ok: true };
    },
  );

  app.get("/playlists", { preHandler: requireToken }, async () => {
    const playlists = all(
      db,
      `SELECT playlists.*,
        (SELECT COUNT(*) FROM playlist_songs WHERE playlist_songs.playlist_id = playlists.id) AS song_count
       FROM playlists
       ORDER BY updated_at DESC`,
    );
    return {
      playlists: playlists.map((playlist) => ({
        ...playlist,
        songs: all(
          db,
          `SELECT songs.*
           FROM playlist_songs
           JOIN songs ON songs.id = playlist_songs.song_id
           WHERE playlist_songs.playlist_id = ?
           ORDER BY playlist_songs.position, playlist_songs.created_at`,
          [playlist.id],
        ),
      })),
    };
  });

  app.post(
    "/playlists",
    { preHandler: requireToken },
    async (request, reply) => {
      const name = normalize(request.body?.name);
      if (!name)
        return reply.code(400).send({ error: "Playlist name is required" });
      const timestamp = now();
      const id = makeId();
      run(
        db,
        "INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        [id, name, timestamp, timestamp],
      );
      await persist(db);
      return { id, name };
    },
  );

  app.post(
    "/playlists/:playlistId/songs",
    { preHandler: requireToken },
    async (request, reply) => {
      const playlistId = normalize(request.params.playlistId);
      const songId = normalize(request.body?.songId);
      if (!get(db, "SELECT id FROM playlists WHERE id = ?", [playlistId])) {
        return reply.code(404).send({ error: "Playlist not found" });
      }
      if (!get(db, "SELECT id FROM songs WHERE id = ?", [songId])) {
        return reply.code(404).send({ error: "Song not found" });
      }
      const position = get(
        db,
        "SELECT COALESCE(MAX(position), 0) + 1 AS next FROM playlist_songs WHERE playlist_id = ?",
        [playlistId],
      )?.next;
      run(
        db,
        "INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, position, created_at) VALUES (?, ?, ?, ?)",
        [playlistId, songId, Number(position) || 1, now()],
      );
      run(db, "UPDATE playlists SET updated_at = ? WHERE id = ?", [
        now(),
        playlistId,
      ]);
      await persist(db);
      return { ok: true };
    },
  );

  app.delete(
    "/playlists/:playlistId/songs/:songId",
    { preHandler: requireToken },
    async (request) => {
      const playlistId = normalize(request.params.playlistId);
      const songId = normalize(request.params.songId);
      run(
        db,
        "DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?",
        [playlistId, songId],
      );
      run(db, "UPDATE playlists SET updated_at = ? WHERE id = ?", [
        now(),
        playlistId,
      ]);
      await persist(db);
      return { ok: true };
    },
  );

  app.delete(
    "/playlists/:playlistId",
    { preHandler: requireToken },
    async (request) => {
      run(db, "DELETE FROM playlists WHERE id = ?", [
        normalize(request.params.playlistId),
      ]);
      await persist(db);
      return { ok: true };
    },
  );

  app.post("/history", { preHandler: requireToken }, async (request, reply) => {
    const songId = normalize(request.body?.songId);
    if (!get(db, "SELECT id FROM songs WHERE id = ?", [songId])) {
      return reply.code(404).send({ error: "Song not found" });
    }
    run(
      db,
      "INSERT INTO history (song_id, played_at, position_seconds) VALUES (?, ?, ?)",
      [songId, now(), Number(request.body?.positionSeconds) || 0],
    );
    await persist(db);
    return { ok: true };
  });

  app.get("/history", { preHandler: requireToken }, async () => ({
    songs: all(
      db,
      `SELECT songs.*, MAX(history.played_at) AS played_at
       FROM history
       JOIN songs ON songs.id = history.song_id
       GROUP BY songs.id
       ORDER BY played_at DESC
       LIMIT 100`,
    ),
  }));

  app.get("/stats", { preHandler: requireToken }, async () => ({
    stats: all(
      db,
      "SELECT song_id, plays, completed, last_played_at FROM play_stats",
    ).reduce(
      (result, row) => ({
        ...result,
        [row.song_id]: {
          plays: Number(row.plays) || 0,
          completed: Number(row.completed) || 0,
          lastPlayedAt: normalize(row.last_played_at),
        },
      }),
      {},
    ),
  }));

  app.post(
    "/stats/:songId",
    { preHandler: requireToken },
    async (request, reply) => {
      const songId = normalize(request.params.songId);
      if (!get(db, "SELECT id FROM songs WHERE id = ?", [songId])) {
        return reply.code(404).send({ error: "Song not found" });
      }
      const plays = Number(request.body?.plays) || 0;
      const completed = Number(request.body?.completed) || 0;
      const lastPlayedAt = normalize(request.body?.lastPlayedAt) || now();
      run(
        db,
        `INSERT INTO play_stats (song_id, plays, completed, last_played_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(song_id) DO UPDATE SET
        plays = MAX(play_stats.plays, excluded.plays),
        completed = MAX(play_stats.completed, excluded.completed),
        last_played_at = CASE
          WHEN excluded.last_played_at > play_stats.last_played_at
          THEN excluded.last_played_at
          ELSE play_stats.last_played_at
        END,
        updated_at = excluded.updated_at`,
        [songId, plays, completed, lastPlayedAt, now()],
      );
      await persist(db);
      return { ok: true };
    },
  );

  app.get("/imports", { preHandler: requireToken }, async () => ({
    jobs: [...importJobs.values()].reverse().map(publicJob),
  }));

  app.get("/imports/:jobId", async (request, reply) => {
    const job = importJobs.get(normalize(request.params.jobId));
    if (!job) return reply.code(404).send({ error: "Import job not found" });
    if (job.mode === "library" && !isAuthorized(request)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return publicJob(job);
  });

  app.get("/imports/:jobId/download", async (request, reply) => {
    const job = importJobs.get(normalize(request.params.jobId));
    if (!job || job.mode !== "download")
      return reply.code(404).send({ error: "Download not found" });
    if (job.status !== "done" || !job.zipPath)
      return reply.code(409).send({ error: "Download is not ready" });
    try {
      const stat = await fs.stat(job.zipPath);
      reply.header("Content-Type", "application/zip");
      reply.header("Content-Length", String(stat.size));
      reply.header(
        "Content-Disposition",
        `attachment; filename="bilibili-audio-${job.id}.zip"`,
      );
      return reply.send(createReadStream(job.zipPath));
    } catch {
      job.downloadUrl = "";
      job.zipPath = "";
      return reply.code(410).send({ error: "Download package expired" });
    }
  });

  app.post("/imports/bilibili", async (request, reply) => {
    try {
      if (
        normalize(request.body?.mode) === "library" &&
        !isAuthorized(request)
      ) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const job = await startBilibiliImport(request.body || {});
      return reply.code(202).send(publicJob(job));
    } catch (error) {
      if (error.runningJob) {
        return reply.code(409).send({
          error: error.message,
          job: publicJob(error.runningJob),
        });
      }
      return reply.code(error.statusCode || 500).send({ error: error.message });
    }
  });

  app.post("/wishlist", async (request, reply) => {
    const title = normalize(request.body?.title);
    if (!title) return reply.code(400).send({ error: "Title is required" });
    run(
      db,
      "INSERT INTO wishlist (title, artist, message, created_at) VALUES (?, ?, ?, ?)",
      [
        title,
        normalize(request.body?.artist),
        normalize(request.body?.message),
        now(),
      ],
    );
    await persist(db);
    return { ok: true };
  });

  app.get("/wishlist", { preHandler: requireToken }, async () => ({
    items: all(db, "SELECT * FROM wishlist ORDER BY created_at DESC LIMIT 200"),
  }));

  await app.listen({ host: config.host, port: config.port });
}
