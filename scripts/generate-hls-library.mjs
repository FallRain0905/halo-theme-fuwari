#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".flac",
  ".m4a",
  ".aac",
  ".ogg",
  ".wav",
]);

function parseArgs(argv) {
  const args = {
    input: "",
    output: "hls-output",
    bitrate: "192k",
    segmentSeconds: 6,
    force: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--input" || arg === "-i") {
      args.input = next;
      i += 1;
    } else if (arg === "--output" || arg === "-o") {
      args.output = next;
      i += 1;
    } else if (arg === "--bitrate" || arg === "-b") {
      args.bitrate = next;
      i += 1;
    } else if (arg === "--segment-seconds") {
      args.segmentSeconds = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--force") {
      args.force = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.input) throw new Error("--input is required");
  return args;
}

function printHelp() {
  console.log(`Generate HLS VOD assets for selected audio files.

Usage:
  pnpm music:hls -- --input "/opt/music-library/public/songs/Dream-Theater-Octavarium.mp3" --output /opt/music-library/hls-test
  pnpm music:hls -- --input /opt/music-library/public/songs --output /opt/music-library/hls-test

Options:
  -i, --input <path>          Audio file or directory.
  -o, --output <dir>          HLS output directory. Default: hls-output
  -b, --bitrate <rate>        AAC bitrate for HLS output. Default: 192k
      --segment-seconds <n>   Segment length. Default: 6
      --force                 Rebuild existing playlists.
`);
}

async function walk(input, root = input, files = []) {
  const entries = await readdir(input, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(input, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, root, files);
    } else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push({ file: fullPath, relative: path.relative(root, fullPath) });
    }
  }
  return files;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

function slugify(input) {
  return input
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function getInputs(input) {
  const resolved = path.resolve(input);
  if (!existsSync(resolved))
    throw new Error(`Input does not exist: ${resolved}`);
  const stat = await import("node:fs/promises").then((fs) => fs.stat(resolved));
  if (stat.isDirectory()) return walk(resolved);
  if (!AUDIO_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    throw new Error(`Input is not a supported audio file: ${resolved}`);
  }
  return [{ file: resolved, relative: path.basename(resolved) }];
}

async function convertOne(item, args) {
  const parsed = path.parse(item.relative);
  const folder =
    slugify(path.join(parsed.dir, parsed.name)) || slugify(parsed.name);
  const outputDir = path.join(path.resolve(args.output), folder);
  const playlist = path.join(outputDir, "index.m3u8");
  if (existsSync(playlist) && !args.force) {
    console.log(`Skip existing: ${playlist}`);
    return { source: item.file, playlist };
  }

  await mkdir(outputDir, { recursive: true });
  const segmentPattern = "seg-%04d.m4s";
  const initFile = "init.mp4";

  console.log(`\nHLS: ${item.file}`);
  await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-y",
      "-i",
      item.file,
      "-vn",
      "-map",
      "0:a:0",
      "-c:a",
      "aac",
      "-b:a",
      args.bitrate,
      "-ar",
      "44100",
      "-ac",
      "2",
      "-f",
      "hls",
      "-hls_time",
      String(args.segmentSeconds),
      "-hls_playlist_type",
      "vod",
      "-hls_segment_type",
      "fmp4",
      "-hls_fmp4_init_filename",
      initFile,
      "-hls_segment_filename",
      segmentPattern,
      "index.m3u8",
    ],
    { cwd: outputDir },
  );

  return { source: item.file, playlist };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputs = await getInputs(args.input);
  const results = [];
  for (const item of inputs) {
    results.push(await convertOne(item, args));
  }
  await mkdir(path.resolve(args.output), { recursive: true });
  await writeFile(
    path.join(path.resolve(args.output), "manifest.json"),
    JSON.stringify(
      results.map((item) => ({
        source: item.source,
        playlist: item.playlist,
      })),
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\nGenerated ${results.length} HLS playlist(s).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
