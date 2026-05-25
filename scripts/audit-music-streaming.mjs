#!/usr/bin/env node
import { createReadStream, existsSync } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseFile } from "music-metadata";

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".flac",
  ".m4a",
  ".aac",
  ".ogg",
  ".wav",
]);
const DEFAULT_INPUT = "/opt/music-library/public";

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    report: "",
    limit: 25,
    clientMbps: 8,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--input" || arg === "-i") {
      args.input = next;
      i += 1;
    } else if (arg === "--report" || arg === "-r") {
      args.report = next;
      i += 1;
    } else if (arg === "--limit" || arg === "-l") {
      args.limit = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--client-mbps") {
      args.clientMbps = Number.parseFloat(next);
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
  console.log(`Audit audio files for web streaming friendliness.

Usage:
  pnpm music:audit -- --input /opt/music-library/public --report streaming-audit.csv

Options:
  -i, --input <dir>       Music library root or songs directory.
                          Default: ${DEFAULT_INPUT}
  -r, --report <file>     Optional CSV report path.
  -l, --limit <number>    Number of highest-risk files to print. Default: 25
      --client-mbps <n>   Estimated client single-connection speed for startup
                          cost calculation. Default: 8 Mbps
`);
}

async function walk(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, files);
    } else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

async function readHead(file, bytes = 1024 * 1024 * 2) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const stream = createReadStream(file, { start: 0, end: bytes - 1 });
    stream.on("data", (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks, total)));
  });
}

function readSynchsafeInt(buffer, offset) {
  return (
    ((buffer[offset] & 0x7f) << 21) |
    ((buffer[offset + 1] & 0x7f) << 14) |
    ((buffer[offset + 2] & 0x7f) << 7) |
    (buffer[offset + 3] & 0x7f)
  );
}

function getId3v2Size(buffer) {
  if (buffer.length < 10) return 0;
  if (buffer.toString("latin1", 0, 3) !== "ID3") return 0;
  const flags = buffer[5];
  const tagSize = readSynchsafeInt(buffer, 6);
  const hasFooter = (flags & 0x10) !== 0;
  return 10 + tagSize + (hasFooter ? 10 : 0);
}

function findMp3FrameOffset(buffer, startAt = 0) {
  for (let i = Math.max(0, startAt); i < buffer.length - 1; i += 1) {
    if (buffer[i] === 0xff && (buffer[i + 1] & 0xe0) === 0xe0) {
      return i;
    }
  }
  return -1;
}

function bytesToMiB(bytes) {
  return bytes / 1024 / 1024;
}

function formatMiB(bytes) {
  return `${bytesToMiB(bytes).toFixed(1)} MiB`;
}

function formatKbps(bitsPerSecond) {
  if (!bitsPerSecond) return "";
  return `${Math.round(bitsPerSecond / 1000)} kbps`;
}

function formatSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${min}:${sec}`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

async function auditFile(file, root, clientMbps) {
  const ext = path.extname(file).toLowerCase();
  const fileStat = await stat(file);
  const issues = [];
  let metadata = null;
  let id3Bytes = 0;
  let firstAudioOffset = 0;

  if (ext === ".mp3") {
    const head = await readHead(file);
    id3Bytes = getId3v2Size(head);
    const frameOffset = findMp3FrameOffset(head, id3Bytes);
    firstAudioOffset = frameOffset >= 0 ? frameOffset : id3Bytes;
  }

  try {
    metadata = await parseFile(file, {
      duration: true,
      skipCovers: true,
      skipPostHeaders: true,
    });
  } catch (error) {
    issues.push(`metadata-error:${error.message}`);
  }

  const bitrate = metadata?.format?.bitrate || 0;
  const duration = metadata?.format?.duration || 0;
  const startupSeconds =
    firstAudioOffset > 0
      ? (firstAudioOffset * 8) / (clientMbps * 1000 * 1000)
      : 0;

  if (ext === ".flac" || ext === ".wav") issues.push("lossless-or-wav");
  if (fileStat.size > 50 * 1024 * 1024) issues.push("large-file");
  if (bitrate > 500_000) issues.push("high-bitrate");
  if (id3Bytes > 1024 * 1024) issues.push("large-id3-tag");
  if (firstAudioOffset > 512 * 1024) issues.push("late-first-audio-frame");
  if (duration > 600 && fileStat.size > 30 * 1024 * 1024)
    issues.push("long-large-track");

  const score =
    (fileStat.size > 50 * 1024 * 1024 ? 4 : 0) +
    (bitrate > 500_000 ? 3 : 0) +
    (id3Bytes > 1024 * 1024 ? 3 : 0) +
    (firstAudioOffset > 512 * 1024 ? 3 : 0) +
    (ext === ".flac" || ext === ".wav" ? 4 : 0) +
    (duration > 600 ? 1 : 0);

  return {
    file,
    relative: path.relative(root, file).replaceAll("\\", "/"),
    ext: ext.slice(1),
    size: fileStat.size,
    duration,
    bitrate,
    id3Bytes,
    firstAudioOffset,
    startupSeconds,
    codec: metadata?.format?.codec || "",
    container: metadata?.format?.container || "",
    issues,
    score,
  };
}

function printSummary(results, limit) {
  const totalSize = results.reduce((sum, item) => sum + item.size, 0);
  const byExt = new Map();
  const issueCounts = new Map();
  for (const item of results) {
    byExt.set(item.ext, (byExt.get(item.ext) || 0) + 1);
    for (const issue of item.issues) {
      issueCounts.set(issue, (issueCounts.get(issue) || 0) + 1);
    }
  }

  console.log(
    `Scanned ${results.length} audio file(s), ${formatMiB(totalSize)} total.`,
  );
  console.log(
    `Formats: ${[...byExt.entries()].map(([ext, count]) => `${ext}:${count}`).join(", ") || "-"}`,
  );
  console.log(
    `Issues: ${
      [...issueCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([issue, count]) => `${issue}:${count}`)
        .join(", ") || "none"
    }`,
  );

  const risky = results
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.size - a.size);
  console.log(`\nHighest-risk files for instant playback:`);
  for (const item of risky.slice(0, limit)) {
    console.log(
      [
        `- ${item.relative}`,
        formatMiB(item.size),
        formatKbps(item.bitrate),
        formatSeconds(item.duration),
        item.id3Bytes ? `id3=${formatMiB(item.id3Bytes)}` : "",
        item.firstAudioOffset
          ? `first-audio=${formatMiB(item.firstAudioOffset)}`
          : "",
        item.startupSeconds
          ? `startup@client=${item.startupSeconds.toFixed(2)}s`
          : "",
        item.issues.join("|"),
      ]
        .filter(Boolean)
        .join(" | "),
    );
  }
}

async function writeCsv(report, results) {
  const header = [
    "file",
    "format",
    "size_mib",
    "duration",
    "bitrate_kbps",
    "id3_mib",
    "first_audio_mib",
    "startup_seconds",
    "codec",
    "container",
    "issues",
  ];
  const rows = results.map((item) => [
    item.relative,
    item.ext,
    bytesToMiB(item.size).toFixed(2),
    formatSeconds(item.duration),
    item.bitrate ? Math.round(item.bitrate / 1000) : "",
    item.id3Bytes ? bytesToMiB(item.id3Bytes).toFixed(2) : "",
    item.firstAudioOffset ? bytesToMiB(item.firstAudioOffset).toFixed(2) : "",
    item.startupSeconds ? item.startupSeconds.toFixed(3) : "",
    item.codec,
    item.container,
    item.issues.join("|"),
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
  await writeFile(report, `${csv}\n`, "utf8");
  console.log(`\nWrote report: ${report}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.input);
  if (!existsSync(root)) {
    throw new Error(`Input directory does not exist: ${root}`);
  }
  const files = await walk(root);
  const results = [];
  for (const file of files) {
    results.push(await auditFile(file, root, args.clientMbps));
  }
  results.sort((a, b) => b.score - a.score || b.size - a.size);
  printSummary(results, args.limit);
  if (args.report) {
    await writeCsv(path.resolve(args.report), results);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
