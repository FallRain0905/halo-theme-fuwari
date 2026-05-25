#!/usr/bin/env node
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const cwd = process.cwd();

function parseArgs(argv) {
  const args = {
    items: [],
    input: "",
    output: "/opt/mv-library/source",
    category: "Bilibili",
    ytDlp: "",
    ffmpegLocation: "",
    cookies: "",
    cookiesFromBrowser: "",
    proxy: "",
    quality: "best",
    formatSelector: "",
    mergeFormat: "mp4",
    playlist: false,
    playlistItems: "",
    flatCategory: false,
    skipExisting: true,
    writeMetadata: true,
    generate: false,
    publicOutput: "/opt/mv-library/public",
    publicBase: "/mv-library",
    categoryDepth: 1,
    cleanPublic: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--") {
      continue;
    } else if (arg === "--bv" || arg === "--url") {
      args.items.push(next);
      i += 1;
    } else if (arg === "--input" || arg === "-i") {
      args.input = next;
      i += 1;
    } else if (arg === "--output" || arg === "-o") {
      args.output = next;
      i += 1;
    } else if (arg === "--category" || arg === "-c") {
      args.category = next;
      i += 1;
    } else if (arg === "--format-selector") {
      args.formatSelector = next;
      i += 1;
    } else if (arg === "--quality") {
      args.quality = next;
      i += 1;
    } else if (arg === "--merge-format") {
      args.mergeFormat = next;
      i += 1;
    } else if (arg === "--yt-dlp") {
      args.ytDlp = next;
      i += 1;
    } else if (arg === "--ffmpeg-location") {
      args.ffmpegLocation = next;
      i += 1;
    } else if (arg === "--cookies") {
      args.cookies = next;
      i += 1;
    } else if (arg === "--cookies-from-browser") {
      args.cookiesFromBrowser = next;
      i += 1;
    } else if (arg === "--proxy") {
      args.proxy = next;
      i += 1;
    } else if (arg === "--playlist") {
      args.playlist = true;
    } else if (arg === "--playlist-items") {
      args.playlistItems = next;
      i += 1;
    } else if (arg === "--flat-category") {
      args.flatCategory = true;
    } else if (arg === "--overwrite") {
      args.skipExisting = false;
    } else if (arg === "--no-write-metadata") {
      args.writeMetadata = false;
    } else if (arg === "--generate") {
      args.generate = true;
    } else if (arg === "--public-output") {
      args.publicOutput = next;
      i += 1;
    } else if (arg === "--public-base") {
      args.publicBase = next;
      i += 1;
    } else if (arg === "--category-depth") {
      args.categoryDepth = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--clean-public") {
      args.cleanPublic = true;
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
  console.log(`Download authorized Bilibili videos into the MV library.

This script wraps yt-dlp and ffmpeg. It is intended for videos you have the
right to archive or republish. It does not bypass account restrictions.

Usage:
  node scripts/download-bili-video.mjs --bv BV1xx411c7mD --category rock --generate
  pnpm bili:video -- --input bili-mv.txt --category live --playlist --playlist-items 1-3

Options:
      --bv <bv>                    Bilibili BV id. Can be repeated.
      --url <url>                  Bilibili video URL. Can be repeated.
  -i, --input <file>               Batch file. Supports plain lines or JSON array.
  -o, --output <dir>               MV source directory.
                                    Default: /opt/mv-library/source
  -c, --category <name>            First-level folder/category for generated JSON.
                                    Default: Bilibili
      --format-selector <format>   yt-dlp format selector.
                                    Overrides --quality when provided.
      --quality <preset>           Video quality preset: best, 2160, 1440,
                                    1080, 720, 480, 360. Default: best
      --merge-format <format>      Merged video container. Default: mp4
      --cookies <file>             Netscape cookies file for your own account.
      --cookies-from-browser <browser[:profile]>
                                    Let yt-dlp read your browser cookies.
      --proxy <url>                Proxy passed to yt-dlp.
      --playlist                   Allow playlist/multi-part downloads.
      --playlist-items <items>     Download selected playlist/multi-part items.
                                    Examples: 1,3,5-8 or 2:10:2.
      --flat-category              Save files directly under <category>/ instead
                                    of <category>/<uploader>/.
      --overwrite                  Re-download existing files.
      --no-write-metadata          Do not write info json/thumbnail/description.
      --generate                   Run generate-mv-library.mjs after download.
      --public-output <dir>        Generated public MV library directory.
                                    Default: /opt/mv-library/public
      --public-base <url>          URL prefix written to mv.json.
                                    Default: /mv-library
      --category-depth <n>         Passed to generate-mv-library.mjs. Default: 1
      --clean-public               Clean public output before generation.
      --yt-dlp <command>           Custom yt-dlp binary path.
      --ffmpeg-location <dir>      Custom ffmpeg directory for yt-dlp.
      --dry-run                    Print commands without running them.
  -h, --help                       Show this help.
`);
}

function toBilibiliUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  const match = text.match(/(BV[0-9A-Za-z]+)/i);
  if (!match) {
    throw new Error(`Invalid BV id or URL: ${value}`);
  }
  return `https://www.bilibili.com/video/${match[1]}`;
}

function sanitizeFolderName(value, fallback = "Bilibili") {
  const safe = String(value || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return safe || fallback;
}

async function readBatchFile(file) {
  if (!file) return [];
  const text = await readFile(file, "utf8");
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    const data = JSON.parse(trimmed);
    if (!Array.isArray(data)) throw new Error("Batch JSON must be an array.");
    return data.map((item) => {
      if (typeof item === "string") return item;
      return item.url || item.bv || item.id || "";
    });
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function run(command, args, options = {}) {
  if (options.dryRun) {
    console.log([command, ...args.map(quoteArg)].join(" "));
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || cwd,
      stdio: options.stdio || "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function runQuiet(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "ignore",
      shell: false,
    });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

function quoteArg(value) {
  const text = String(value);
  if (!/[\s"'`]/.test(text)) return text;
  return JSON.stringify(text);
}

async function resolveYtDlp(custom) {
  if (custom) {
    if (await runQuiet(custom, ["--version"]))
      return { command: custom, args: [] };
    throw new Error(`yt-dlp is not executable: ${custom}`);
  }

  const binaryCandidates = [
    "yt-dlp",
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
    "/snap/bin/yt-dlp",
    "/root/.local/bin/yt-dlp",
  ];

  for (const command of binaryCandidates) {
    if (await runQuiet(command, ["--version"])) {
      return { command, args: [] };
    }
  }

  if (await runQuiet("python", ["-m", "yt_dlp", "--version"])) {
    return { command: "python", args: ["-m", "yt_dlp"] };
  }
  if (await runQuiet("python3", ["-m", "yt_dlp", "--version"])) {
    return { command: "python3", args: ["-m", "yt_dlp"] };
  }

  throw new Error(
    `yt-dlp was not found. PATH=${process.env.PATH || ""}. Install it or pass --yt-dlp /full/path/to/yt-dlp`,
  );
}

async function assertFfmpegAvailable(args) {
  if (args.ffmpegLocation) return;
  if (await runQuiet("ffmpeg", ["-version"])) return;
  throw new Error(
    "ffmpeg was not found. Install ffmpeg first, or pass --ffmpeg-location <dir>.",
  );
}

function buildYtDlpArgs(args, targetUrl) {
  const category = sanitizeFolderName(args.category);
  const formatSelector = resolveFormatSelector(args);
  const outputTemplate = args.flatCategory
    ? path.posix.join(category, "%(title).180B [%(id)s].%(ext)s")
    : path.posix.join(
        category,
        "%(uploader|Bilibili)s",
        "%(title).180B [%(id)s].%(ext)s",
      );

  const commandArgs = [
    ...(args.playlist ? [] : ["--no-playlist"]),
    "--windows-filenames",
    "--paths",
    `home:${args.output}`,
    "-o",
    outputTemplate,
    "-f",
    formatSelector,
    "--merge-output-format",
    args.mergeFormat,
  ];

  if (args.playlistItems) {
    commandArgs.push("--playlist-items", args.playlistItems);
  }
  if (args.skipExisting) commandArgs.push("--no-overwrites");
  if (args.writeMetadata) {
    commandArgs.push(
      "--write-info-json",
      "--write-thumbnail",
      "--convert-thumbnails",
      "jpg",
      "--write-description",
      "--add-metadata",
      "--embed-thumbnail",
    );
  }
  if (args.ffmpegLocation) {
    commandArgs.push("--ffmpeg-location", args.ffmpegLocation);
  }
  if (args.cookies) {
    commandArgs.push("--cookies", args.cookies);
  }
  if (args.cookiesFromBrowser) {
    commandArgs.push("--cookies-from-browser", args.cookiesFromBrowser);
  }
  if (args.proxy) {
    commandArgs.push("--proxy", args.proxy);
  }

  commandArgs.push(targetUrl);
  return commandArgs;
}

function resolveFormatSelector(args) {
  if (args.formatSelector) return args.formatSelector;
  if (args.quality === "best") return "bv*+ba/b";
  const height = Number.parseInt(args.quality, 10);
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error(
      "--quality must be one of: best, 2160, 1440, 1080, 720, 480, 360.",
    );
  }
  return `bv*[height<=${height}]+ba/b[height<=${height}]/best[height<=${height}]`;
}

async function generateLibrary(args) {
  const script = path.join(cwd, "scripts", "generate-mv-library.mjs");
  const commandArgs = [
    script,
    "--input",
    args.output,
    "--output",
    args.publicOutput,
    "--public-base",
    args.publicBase,
    "--category-depth",
    String(args.categoryDepth),
    args.cleanPublic ? "--clean" : "--skip-existing",
  ];
  await run(process.execPath, commandArgs, { dryRun: args.dryRun });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const batchItems = await readBatchFile(args.input);
  const urls = [...args.items, ...batchItems]
    .map(toBilibiliUrl)
    .filter(Boolean);

  if (!urls.length) {
    throw new Error("No BV id or Bilibili URL was provided.");
  }
  if (!Number.isFinite(args.categoryDepth)) {
    throw new Error("--category-depth must be a number.");
  }
  if (!/^(mp4|mkv|webm)$/i.test(args.mergeFormat)) {
    throw new Error("--merge-format must be one of: mp4, mkv, webm.");
  }

  args.output = path.resolve(cwd, args.output);
  args.publicOutput = path.resolve(cwd, args.publicOutput);
  await mkdir(args.output, { recursive: true });

  const ytDlp = args.dryRun
    ? { command: args.ytDlp || "yt-dlp", args: [] }
    : await resolveYtDlp(args.ytDlp);
  if (!args.dryRun) {
    await assertFfmpegAvailable(args);
  }

  console.log(`MV source directory: ${args.output}`);
  console.log(`Category: ${sanitizeFolderName(args.category)}`);
  console.log(`Video count: ${urls.length}`);

  for (const url of urls) {
    const commandArgs = [...ytDlp.args, ...buildYtDlpArgs(args, url)];
    await run(ytDlp.command, commandArgs, { dryRun: args.dryRun });
  }

  if (args.generate) {
    await generateLibrary(args);
  }

  console.log("Bilibili video import finished.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
