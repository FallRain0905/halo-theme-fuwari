#!/usr/bin/env node
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const VIDEO_EXTENSIONS = new Set([".mp4"]);
const SIDECAR_EXTENSIONS = new Set([
  ".info.json",
  ".description",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
]);
const cwd = process.cwd();

function parseArgs(argv) {
  const args = {
    input: "/opt/mv-library/source",
    output: "/opt/mv-library/optimized",
    ffmpeg: "ffmpeg",
    skipExisting: true,
    clean: false,
    dryRun: false,
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
    } else if (arg === "--ffmpeg") {
      args.ffmpeg = next;
      i += 1;
    } else if (arg === "--overwrite") {
      args.skipExisting = false;
    } else if (arg === "--clean") {
      args.clean = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
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
  console.log(`Optimize MV MP4 files for web playback using faststart.

This script does not transcode. It runs ffmpeg with:
  -c copy -movflags +faststart

Usage:
  node scripts/optimize-mv-library.mjs --input /opt/mv-library/source --output /opt/mv-library/optimized

Options:
  -i, --input <dir>    Source directory. Default: /opt/mv-library/source
  -o, --output <dir>   Output directory. Default: /opt/mv-library/optimized
      --ffmpeg <path>  ffmpeg command or full path. Default: ffmpeg
      --overwrite      Rebuild existing optimized files.
      --clean          Remove output directory before optimizing.
      --dry-run        Print commands without running them.
  -h, --help           Show this help.
`);
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

function quoteArg(value) {
  const text = String(value);
  if (!/[\s"'`]/.test(text)) return text;
  return JSON.stringify(text);
}

function run(command, args, options = {}) {
  if (options.dryRun) {
    console.log([command, ...args.map(quoteArg)].join(" "));
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function copySidecars(inputDir, outputDir, skipExisting) {
  const files = await walk(inputDir);
  let copied = 0;
  let skipped = 0;
  for (const file of files) {
    const lower = file.toLowerCase();
    const isSidecar = [...SIDECAR_EXTENSIONS].some((ext) =>
      lower.endsWith(ext),
    );
    if (!isSidecar) continue;
    const target = path.join(outputDir, path.relative(inputDir, file));
    if (skipExisting && existsSync(target)) {
      skipped += 1;
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file, target);
    copied += 1;
  }
  return { copied, skipped };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputDir = path.resolve(cwd, args.input);
  const outputDir = path.resolve(cwd, args.output);

  if (!existsSync(inputDir)) {
    throw new Error(`Input directory does not exist: ${inputDir}`);
  }

  if (args.clean && existsSync(outputDir)) {
    await rm(outputDir, { recursive: true, force: true });
  }

  await mkdir(outputDir, { recursive: true });
  const files = await walk(inputDir);
  const videos = files.filter((file) =>
    VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase()),
  );

  let optimized = 0;
  let skipped = 0;

  for (const file of videos) {
    const relative = path.relative(inputDir, file);
    const target = path.join(outputDir, relative);
    if (args.skipExisting && existsSync(target)) {
      skipped += 1;
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await run(
      args.ffmpeg,
      [
        "-y",
        "-i",
        file,
        "-map",
        "0",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        target,
      ],
      { dryRun: args.dryRun },
    );
    optimized += 1;
  }

  const sidecars = await copySidecars(inputDir, outputDir, args.skipExisting);
  console.log(
    `Optimized ${optimized} video(s), skipped ${skipped}. Copied ${sidecars.copied} sidecar file(s), skipped ${sidecars.skipped}.`,
  );
  console.log(`Output: ${outputDir}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
