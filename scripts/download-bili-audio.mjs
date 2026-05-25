#!/usr/bin/env node
import { mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const cwd = process.cwd();

function parseArgs(argv) {
  const args = {
    items: [],
    input: "",
    output: "/opt/music-library/source",
    category: "Bilibili",
    format: "mp3",
    audioQuality: "0",
    ytDlp: "",
    ffmpegLocation: "",
    cookies: "",
    cookiesFromBrowser: "",
    proxy: "",
    playlist: false,
    playlistItems: "",
    flatCategory: false,
    skipExisting: true,
    embedMetadata: true,
    generate: false,
    publicOutput: "/opt/music-library/public",
    publicBase: "/music-library",
    generateInput: "",
    categoryDepth: 1,
    cleanPublic: false,
    syncUrl: "",
    token: "",
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
    } else if (arg === "--format" || arg === "-f") {
      args.format = next;
      i += 1;
    } else if (arg === "--audio-quality") {
      args.audioQuality = next;
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
    } else if (arg === "--no-embed-metadata") {
      args.embedMetadata = false;
    } else if (arg === "--generate") {
      args.generate = true;
    } else if (arg === "--public-output") {
      args.publicOutput = next;
      i += 1;
    } else if (arg === "--public-base") {
      args.publicBase = next;
      i += 1;
    } else if (arg === "--generate-input") {
      args.generateInput = next;
      i += 1;
    } else if (arg === "--category-depth") {
      args.categoryDepth = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--clean-public") {
      args.cleanPublic = true;
    } else if (arg === "--sync-url") {
      args.syncUrl = next;
      i += 1;
    } else if (arg === "--token") {
      args.token = next;
      i += 1;
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
  console.log(`Download authorized Bilibili video audio into the existing music library.

This script wraps yt-dlp and ffmpeg. It is intended for audio you have the
right to archive or republish. It does not bypass account restrictions.

Usage:
  node scripts/download-bili-audio.mjs --bv BV1xx411c7mD --category 听力音频 --generate
  pnpm bili:audio -- --input bili.txt --category Bilibili --generate

Options:
      --bv <bv>                  Bilibili BV id. Can be repeated.
      --url <url>                Bilibili video URL. Can be repeated.
  -i, --input <file>             Batch file. Supports plain lines or JSON array.
  -o, --output <dir>             Music source directory.
                                  Default: /opt/music-library/source
  -c, --category <name>          First-level folder/category for generated JSON.
                                  Default: Bilibili
  -f, --format <mp3|m4a|opus>    Output audio format. Default: mp3
      --audio-quality <value>    yt-dlp audio quality. Default: 0
      --cookies <file>           Netscape cookies file for your own account.
      --cookies-from-browser <browser[:profile]>
                                  Let yt-dlp read your browser cookies.
      --proxy <url>              Proxy passed to yt-dlp.
      --playlist                 Allow playlist downloads. Default is single video.
      --playlist-items <items>   Download selected playlist/multi-part items.
                                  Examples: 1,3,5-8 or 2:10:2.
      --flat-category            Save files directly under <category>/ instead
                                  of <category>/<uploader>/.
      --overwrite                Re-download existing files.
      --no-embed-metadata        Do not embed metadata/thumbnail.
      --generate                 Run generate-music-library.mjs after download.
      --public-output <dir>      Generated public library directory.
                                  Default: /opt/music-library/public
      --public-base <url>        URL prefix written to songs.json.
                                  Default: /music-library
      --generate-input <dir>     Source root scanned by generate-music-library.
                                  Default: same as --output
      --category-depth <n>       Passed to generate-music-library.mjs. Default: 1
      --clean-public             Clean public output before generation.
      --sync-url <url>           Optional Music API sync URL.
      --token <token>            Bearer token for --sync-url.
      --yt-dlp <command>         Custom yt-dlp binary path.
      --ffmpeg-location <dir>    Custom ffmpeg directory for yt-dlp.
      --dry-run                  Print commands without running them.
  -h, --help                     Show this help.
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

  if (await runQuiet("yt-dlp", ["--version"])) {
    return { command: "yt-dlp", args: [] };
  }

  if (await runQuiet("python", ["-m", "yt_dlp", "--version"])) {
    return { command: "python", args: ["-m", "yt_dlp"] };
  }

  throw new Error(
    "yt-dlp was not found. Install it with: python -m pip install -U yt-dlp",
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
    "-x",
    "--audio-format",
    args.format,
    "--audio-quality",
    args.audioQuality,
  ];

  if (args.playlistItems) {
    commandArgs.push("--playlist-items", args.playlistItems);
  }

  if (args.skipExisting) commandArgs.push("--no-overwrites");
  if (args.embedMetadata) {
    commandArgs.push(
      "--add-metadata",
      "--embed-thumbnail",
      "--convert-thumbnails",
      "jpg",
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

async function generateLibrary(args) {
  const script = path.join(cwd, "scripts", "generate-music-library.mjs");
  const commandArgs = [
    script,
    "--input",
    args.generateInput || args.output,
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

async function syncMusicApi(args) {
  if (!args.syncUrl) return;
  if (!args.token) {
    throw new Error("--sync-url requires --token <token>.");
  }
  if (args.dryRun) {
    console.log(
      `POST ${args.syncUrl} Authorization: Bearer ${args.token.slice(0, 4)}...`,
    );
    return;
  }

  const response = await fetch(args.syncUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.token}`,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Music API sync failed: ${response.status} ${body}`);
  }
  console.log(await response.text());
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
  if (!/^(mp3|m4a|opus|flac|wav)$/i.test(args.format)) {
    throw new Error("--format must be one of: mp3, m4a, opus, flac, wav.");
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

  console.log(`Audio source directory: ${args.output}`);
  console.log(`Category: ${sanitizeFolderName(args.category)}`);
  console.log(`Video count: ${urls.length}`);

  for (const url of urls) {
    const commandArgs = [...ytDlp.args, ...buildYtDlpArgs(args, url)];
    await run(ytDlp.command, commandArgs, { dryRun: args.dryRun });
  }

  if (args.generate) {
    if (args.cleanPublic && existsSync(args.publicOutput)) {
      await rm(args.publicOutput, { recursive: true, force: true });
    }
    await generateLibrary(args);
    await syncMusicApi(args);
  }

  console.log("Bilibili audio import finished.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
