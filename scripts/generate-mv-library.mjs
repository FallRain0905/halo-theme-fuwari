#!/usr/bin/env node
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mkv", ".mov"]);
const COVER_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const cwd = process.cwd();

function parseArgs(argv) {
  const args = {
    input: "mv-source",
    output: "public/assets/mv/library",
    publicBase: "/themes/theme-fuwari/assets/mv/library",
    clean: false,
    skipExisting: false,
    categoryDepth: 1,
    ffprobe: "ffprobe",
    noFfprobe: false,
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
    } else if (arg === "--clean") {
      args.clean = true;
    } else if (arg === "--skip-existing") {
      args.skipExisting = true;
    } else if (arg === "--category-depth") {
      args.categoryDepth = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--ffprobe") {
      args.ffprobe = next;
      i += 1;
    } else if (arg === "--no-ffprobe") {
      args.noFfprobe = true;
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
  console.log(`Generate MV library JSON from local video files.

Usage:
  pnpm mv:generate -- --input /opt/mv-library/source --output /opt/mv-library/public --public-base /mv-library

Options:
  -i, --input <dir>        Source directory with mp4/webm/mkv/mov files.
                           Default: mv-source
  -o, --output <dir>       Output directory. Default: public/assets/mv/library
  -b, --public-base <url>  URL prefix written to mv.json.
                           Default: /themes/theme-fuwari/assets/mv/library
      --clean             Remove output directory before generating.
      --skip-existing     Keep existing generated files instead of overwriting them.
      --category-depth <n> Use the nth source folder as category. Default: 1.
                           Use 0 to disable folder categories.
      --ffprobe <command>  ffprobe command path. Default: ffprobe
      --no-ffprobe         Do not read duration from video files.
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

function sanitizeName(value, fallback = "mv") {
  const safe = String(value || fallback)
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 110);
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

function uniqueId(used, base) {
  const safe = sanitizeName(base || "mv").toLowerCase();
  let id = safe;
  let index = 2;
  while (used.has(id)) {
    id = `${safe}-${index}`;
    index += 1;
  }
  used.add(id);
  return id;
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

async function readJson(file) {
  if (!file || !existsSync(file)) return null;
  try {
    const text = await readFile(file, "utf8");
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    console.warn(`Failed to read JSON: ${file}`);
    console.warn(`  ${error.message}`);
    return null;
  }
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

async function findInfoJson(basePath) {
  const dir = path.dirname(basePath);
  const stem = path.basename(basePath, path.extname(basePath));
  const exact = path.join(dir, `${stem}.info.json`);
  if (existsSync(exact)) return exact;

  const match = stem.match(/\[([A-Za-z0-9_-]+)\]$/);
  if (!match) return "";
  const files = await readdir(dir).catch(() => []);
  const id = match[1].toLowerCase();
  const found = files.find(
    (file) =>
      file.toLowerCase().endsWith(".info.json") &&
      file.toLowerCase().includes(`[${id}]`),
  );
  return found ? path.join(dir, found) : "";
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const hour = Math.floor(total / 3600);
  const min = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (hour > 0) {
    return `${hour}:${min < 10 ? "0" : ""}${min}:${sec < 10 ? "0" : ""}${sec}`;
  }
  return `${min}:${sec < 10 ? "0" : ""}${sec}`;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeSourceUrl(info) {
  return firstText(
    info?.webpage_url,
    info?.original_url,
    info?.url && /^https?:\/\//i.test(info.url) ? info.url : "",
  );
}

function getBvid(info, file) {
  const fromInfo = firstText(info?.bvid, info?.id);
  if (fromInfo) return fromInfo;
  const match = path.basename(file).match(/\[(BV[0-9A-Za-z]+)\]/i);
  return match?.[1] || "";
}

function runCapture(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      shell: false,
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", () => resolve(""));
    child.on("exit", (code) => resolve(code === 0 ? output : ""));
  });
}

async function readDurationWithFfprobe(file, command) {
  const output = await runCapture(command, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const seconds = Number.parseFloat(output.trim());
  return Number.isFinite(seconds) ? seconds : 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputDir = path.resolve(cwd, args.input);
  const outputDir = path.resolve(cwd, args.output);
  const videosDir = path.join(outputDir, "videos");
  const coversDir = path.join(outputDir, "covers");

  if (!existsSync(inputDir)) {
    throw new Error(`Input directory does not exist: ${inputDir}`);
  }

  if (args.clean && existsSync(outputDir)) {
    await rm(outputDir, { recursive: true, force: true });
  }

  await mkdir(videosDir, { recursive: true });
  await mkdir(coversDir, { recursive: true });

  const files = await walk(inputDir);
  const videoFiles = files.filter((file) =>
    VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase()),
  );
  const usedVideoNames = new Set();
  const usedCoverNames = new Set();
  const usedIds = new Set();
  const mvs = [];

  for (const file of videoFiles) {
    const ext = path.extname(file).toLowerCase();
    const relativeDir = path.dirname(path.relative(inputDir, file));
    const category = getFolderCategory(relativeDir, args.categoryDepth);
    const infoFile = await findInfoJson(file);
    const info = (await readJson(infoFile)) || {};
    const bvid = getBvid(info, file);
    const title = firstText(info.title, path.basename(file, ext));
    const artist = firstText(
      info.uploader,
      info.channel,
      info.creator,
      "Unknown",
    );
    const source = normalizeSourceUrl(info);
    const rawDuration = Number(info.duration) || 0;
    const probedDuration =
      rawDuration || args.noFfprobe
        ? 0
        : await readDurationWithFfprobe(file, args.ffprobe);
    const duration = formatDuration(rawDuration || probedDuration);
    const baseName = sanitizeName(
      `${artist}-${title}`,
      path.basename(file, ext),
    );

    const videoName = uniqueName(usedVideoNames, baseName, ext);
    await copyGeneratedFile(file, path.join(videosDir, videoName), {
      skipExisting: args.skipExisting,
    });
    const videoUrl = joinUrl(
      args.publicBase,
      "videos",
      encodeURIComponent(videoName),
    );

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
    }

    const baseId = bvid
      ? `bili-${bvid}${info.playlist_index ? `-p${info.playlist_index}` : ""}`
      : sanitizeName(title);

    mvs.push({
      id: uniqueId(usedIds, baseId),
      title,
      artist,
      category,
      cover: coverUrl,
      url: videoUrl,
      source,
      bvid,
      duration,
      description: firstText(info.description),
    });
  }

  mvs.sort((a, b) => {
    const category = a.category.localeCompare(b.category, "zh-Hans-CN");
    if (category) return category;
    const artist = a.artist.localeCompare(b.artist, "zh-Hans-CN");
    if (artist) return artist;
    return a.title.localeCompare(b.title, "zh-Hans-CN");
  });

  await writeGeneratedFile(
    path.join(outputDir, "mv.json"),
    `${JSON.stringify(mvs, null, 2)}\n`,
    { encoding: "utf8" },
  );

  console.log(`Generated ${mvs.length} MV item(s).`);
  console.log(`Output: ${toPosix(path.relative(cwd, outputDir))}`);
  console.log(`JSON URL: ${joinUrl(args.publicBase, "mv.json")}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
