#!/usr/bin/env node
import {
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseFile } from "music-metadata";

const AUDIO_EXTENSIONS = new Set([".mp3", ".flac", ".m4a", ".ogg", ".wav"]);
const COVER_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const LYRIC_EXTENSIONS = new Set([".lrc", ".txt"]);

const cwd = process.cwd();

function parseArgs(argv) {
  const args = {
    input: "music-source",
    output: "public/assets/music/library",
    publicBase: "/themes/theme-fuwari/assets/music/library",
    audioBase: "",
    clean: false,
    copyAudio: true,
    skipExisting: false,
    categoryDepth: 1,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--") {
      continue;
    } else if (arg === "--input" || arg === "-i") {
      args.input = next;
      i += 1;
    } else if (arg === "--output" || arg === "-o") {
      args.output = next;
      i += 1;
    } else if (arg === "--public-base" || arg === "-b") {
      args.publicBase = next;
      i += 1;
    } else if (arg === "--audio-base") {
      args.audioBase = next;
      i += 1;
    } else if (arg === "--clean") {
      args.clean = true;
    } else if (arg === "--no-copy-audio") {
      args.copyAudio = false;
    } else if (arg === "--skip-existing") {
      args.skipExisting = true;
    } else if (arg === "--category-depth") {
      args.categoryDepth = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Generate Fuwari music library JSON from local audio files.

Usage:
  pnpm music:generate -- --input music-source --clean

Options:
  -i, --input <dir>        Source directory with mp3/flac/etc. Default: music-source
  -o, --output <dir>       Output directory. Default: public/assets/music/library
  -b, --public-base <url>  URL prefix written to songs.json.
                           Default: /themes/theme-fuwari/assets/music/library
      --clean             Remove output directory before generating.
      --skip-existing     Keep existing generated files instead of overwriting them.
      --no-copy-audio     Do not copy audio files; only write metadata for existing URLs.
      --audio-base <url>   URL prefix for source audio when --no-copy-audio is used.
      --category-depth <n> Use the nth source folder as category. Default: 1.
                           Use 0 to disable folder categories.
  -h, --help              Show this help.
`);
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function joinUrl(...parts) {
  return parts
    .filter(Boolean)
    .map((part, index) => {
      const text = String(part);
      if (index === 0) return text.replace(/\/+$/, "");
      return text.replace(/^\/+|\/+$/g, "");
    })
    .join("/");
}

function getFolderCategory(relativeDir, depth) {
  if (!Number.isFinite(depth) || depth <= 0) return "";
  if (!relativeDir || relativeDir === ".") return "";
  const folders = relativeDir.split(path.sep).filter(Boolean);
  return folders[depth - 1] || "";
}

function getTrackNumber(common, filename) {
  const embedded = Number.parseInt(common.track?.no, 10);
  if (Number.isFinite(embedded) && embedded > 0) return embedded;
  const match = path
    .basename(filename)
    .match(/^(\d{1,3})(?:\s*[.、_-]\s*|\s+)/);
  if (!match) return 0;
  const fromName = Number.parseInt(match[1], 10);
  return Number.isFinite(fromName) ? fromName : 0;
}

function compareNullableNumber(a, b) {
  if (a && b) return a - b;
  if (a) return -1;
  if (b) return 1;
  return 0;
}

function sanitizeName(value, fallback = "track") {
  const safe = String(value || fallback)
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 90);
  return safe || fallback;
}

function uniqueName(used, base, ext) {
  let name = `${base}${ext}`;
  let index = 2;
  while (used.has(name.toLowerCase())) {
    name = `${base}-${index}${ext}`;
    index += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

async function writeGeneratedFile(file, data, options = {}) {
  if (options.skipExisting && existsSync(file)) return;
  await writeFile(file, data, options.encoding);
}

async function copyGeneratedFile(source, target, options = {}) {
  if (options.skipExisting && existsSync(target)) return;
  await copyFile(source, target);
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function readExistingSongs(file) {
  if (!existsSync(file)) return [];
  try {
    const text = (await readFile(file, "utf8")).replace(/^\uFEFF/, "");
    const data = JSON.parse(text);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.songs)) return data.songs;
  } catch (error) {
    console.warn(`Failed to read existing songs JSON: ${file}`);
    console.warn(`  ${error.message}`);
  }
  return [];
}

function songKey(song) {
  const url = String(song?.url || song?.src || "").trim();
  if (url) return `url:${decodeURIComponent(url).toLowerCase()}`;
  return [
    "meta",
    song?.title || song?.name || "",
    song?.artist || song?.author || "",
    song?.album || "",
  ]
    .map((part) => String(part).trim().toLowerCase())
    .join(":");
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${sec < 10 ? "0" : ""}${sec}`;
}

function extensionFromMime(mime) {
  if (!mime) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  return ".jpg";
}

function firstText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = firstText(item);
      if (text) return text;
    }
    return "";
  }
  if (typeof value === "object") {
    return value.text || value.lyrics || value.description || "";
  }
  return "";
}

function collectLyrics(metadata) {
  const common = metadata.common || {};
  const candidates = [
    common.lyrics,
    common.unsynchronisedLyrics,
    common.synchronizedLyrics,
  ];

  for (const candidate of candidates) {
    const text = firstText(candidate);
    if (text) return text;
  }

  for (const tags of Object.values(metadata.native || {})) {
    for (const tag of tags || []) {
      const id = String(tag.id || "");
      if (!/lyric|uslt|sylt/i.test(id)) continue;
      const text = firstText(tag.value);
      if (text) return text;
    }
  }

  return "";
}

async function findSidecar(basePath, extensions) {
  const dir = path.dirname(basePath);
  const stem = path.basename(basePath, path.extname(basePath));
  for (const ext of extensions) {
    const candidate = path.join(dir, `${stem}${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return "";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputDir = path.resolve(cwd, args.input);
  const outputDir = path.resolve(cwd, args.output);
  const songsDir = path.join(outputDir, "songs");
  const coversDir = path.join(outputDir, "covers");
  const lyricsDir = path.join(outputDir, "lyrics");
  const songsJson = path.join(outputDir, "songs.json");

  if (!existsSync(inputDir)) {
    throw new Error(`Input directory does not exist: ${inputDir}`);
  }
  if (!args.copyAudio && !args.audioBase) {
    throw new Error("--no-copy-audio requires --audio-base <url>");
  }

  if (args.clean && existsSync(outputDir)) {
    await rm(outputDir, { recursive: true, force: true });
  }

  await mkdir(songsDir, { recursive: true });
  await mkdir(coversDir, { recursive: true });
  await mkdir(lyricsDir, { recursive: true });

  const files = await walk(inputDir);
  const audioFiles = files.filter((file) =>
    AUDIO_EXTENSIONS.has(path.extname(file).toLowerCase()),
  );
  const usedAudioNames = new Set();
  const usedCoverNames = new Set();
  const usedLyricNames = new Set();
  const songs = [];

  for (const file of audioFiles) {
    const ext = path.extname(file).toLowerCase();
    const metadata = await parseFile(file, {
      duration: true,
      skipCovers: false,
    }).catch((error) => {
      console.warn(`Failed to read metadata: ${file}`);
      console.warn(`  ${error.message}`);
      return { common: {}, format: {} };
    });

    const common = metadata.common || {};
    const stem = sanitizeName(path.basename(file, ext));
    const relativeDir = path.dirname(path.relative(inputDir, file));
    const category = getFolderCategory(relativeDir, args.categoryDepth);
    const title = common.title || path.basename(file, ext);
    const artist = Array.isArray(common.artists)
      ? common.artists.join(" / ")
      : common.artist || "Unknown Artist";
    const album = common.album || "Unknown Album";
    const track = getTrackNumber(common, file);
    const baseName = sanitizeName(`${artist}-${title}`, stem);

    let audioUrl = "";
    if (args.copyAudio) {
      const audioName = uniqueName(usedAudioNames, baseName, ext);
      await copyGeneratedFile(file, path.join(songsDir, audioName), {
        skipExisting: args.skipExisting,
      });
      audioUrl = joinUrl(
        args.publicBase,
        "songs",
        encodeURIComponent(audioName),
      );
    } else if (args.audioBase) {
      const relativeAudioPath = toPosix(path.relative(inputDir, file));
      audioUrl = joinUrl(args.audioBase, encodeURI(relativeAudioPath));
    }

    let coverUrl = "";
    const sidecarCover = await findSidecar(file, COVER_EXTENSIONS);
    if (sidecarCover) {
      const coverExt = path.extname(sidecarCover).toLowerCase();
      const coverName = uniqueName(usedCoverNames, baseName, coverExt);
      await copyGeneratedFile(sidecarCover, path.join(coversDir, coverName), {
        skipExisting: args.skipExisting,
      });
      coverUrl = joinUrl(
        args.publicBase,
        "covers",
        encodeURIComponent(coverName),
      );
    } else if (common.picture?.[0]?.data) {
      const picture = common.picture[0];
      const coverExt = extensionFromMime(picture.format);
      const coverName = uniqueName(usedCoverNames, baseName, coverExt);
      await writeGeneratedFile(path.join(coversDir, coverName), picture.data, {
        skipExisting: args.skipExisting,
      });
      coverUrl = joinUrl(
        args.publicBase,
        "covers",
        encodeURIComponent(coverName),
      );
    }

    let lyricUrl = "";
    const sidecarLyric = await findSidecar(file, LYRIC_EXTENSIONS);
    if (sidecarLyric) {
      const lyricExt = path.extname(sidecarLyric).toLowerCase();
      const lyricName = uniqueName(usedLyricNames, baseName, lyricExt);
      await copyGeneratedFile(sidecarLyric, path.join(lyricsDir, lyricName), {
        skipExisting: args.skipExisting,
      });
      lyricUrl = joinUrl(
        args.publicBase,
        "lyrics",
        encodeURIComponent(lyricName),
      );
    } else {
      const lyricText = collectLyrics(metadata).trim();
      if (lyricText) {
        const lyricName = uniqueName(usedLyricNames, baseName, ".lrc");
        await writeGeneratedFile(
          path.join(lyricsDir, lyricName),
          `${lyricText}\n`,
          {
            encoding: "utf8",
            skipExisting: args.skipExisting,
          },
        );
        lyricUrl = joinUrl(
          args.publicBase,
          "lyrics",
          encodeURIComponent(lyricName),
        );
      }
    }

    songs.push({
      title,
      artist,
      album,
      category,
      track,
      cover: coverUrl,
      url: audioUrl,
      lrc: lyricUrl,
      duration: formatDuration(metadata.format?.duration),
    });
  }

  songs.sort((a, b) => {
    const category = a.category.localeCompare(b.category, "zh-Hans-CN");
    if (category) return category;
    const album = a.album.localeCompare(b.album, "zh-Hans-CN");
    if (album) return album;
    const track = compareNullableNumber(a.track, b.track);
    if (track) return track;
    return a.title.localeCompare(b.title, "zh-Hans-CN");
  });

  const mergedSongs = args.skipExisting
    ? [...(await readExistingSongs(songsJson)), ...songs].reduce(
        (result, song) => {
          const key = songKey(song);
          if (key) result.set(key, song);
          return result;
        },
        new Map(),
      )
    : null;
  const outputSongs = mergedSongs ? [...mergedSongs.values()] : songs;

  outputSongs.sort((a, b) => {
    const category = String(a.category || "").localeCompare(
      String(b.category || ""),
      "zh-Hans-CN",
    );
    if (category) return category;
    const album = String(a.album || "").localeCompare(
      String(b.album || ""),
      "zh-Hans-CN",
    );
    if (album) return album;
    const track = compareNullableNumber(Number(a.track), Number(b.track));
    if (track) return track;
    return String(a.title || "").localeCompare(
      String(b.title || ""),
      "zh-Hans-CN",
    );
  });

  await writeFile(
    songsJson,
    `${JSON.stringify(outputSongs, null, 2)}\n`,
    "utf8",
  );

  console.log(`Generated ${outputSongs.length} song(s).`);
  if (mergedSongs) {
    console.log(
      `Merged ${songs.length} scanned song(s) with existing songs.json.`,
    );
  }
  console.log(`Output: ${toPosix(path.relative(cwd, outputDir))}`);
  console.log(`JSON URL: ${joinUrl(args.publicBase, "songs.json")}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
