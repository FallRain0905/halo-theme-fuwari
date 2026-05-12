#!/usr/bin/env node
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const cwd = process.cwd();
const SIDECAR_EXTENSIONS = new Set([
  ".lrc",
  ".txt",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
]);

function parseArgs(argv) {
  const args = {
    input: "/opt/music-library/ncm-source",
    output: "/opt/music-library/source",
    binary: "ncmdump-go",
    recursive: true,
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
    } else if (arg === "--binary" || arg === "-b") {
      args.binary = next;
      i += 1;
    } else if (arg === "--no-recursive") {
      args.recursive = false;
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
  console.log(`Convert local NetEase .ncm files before generating the music library.

This wrapper only calls an installed ncmdump-go binary. It does not download
music or manage any third-party account.

Usage:
  pnpm ncm:convert -- --input /opt/music-library/ncm-source --output /opt/music-library/source

Options:
  -i, --input <dir>       Directory containing .ncm files.
                          Default: /opt/music-library/ncm-source
  -o, --output <dir>      Directory for converted audio files.
                          Default: /opt/music-library/source
  -b, --binary <command>  ncmdump-go binary path or command name.
                          Default: ncmdump-go
      --no-recursive      Do not recursively scan source directories.
  -h, --help              Show this help.
`);
}

function run(command, args) {
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

async function copySidecars(inputDir, outputDir) {
  const files = await walk(inputDir);
  let count = 0;
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!SIDECAR_EXTENSIONS.has(ext)) continue;
    const relative = path.relative(inputDir, file);
    const target = path.join(outputDir, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file, target);
    count += 1;
  }
  return count;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputDir = path.resolve(cwd, args.input);
  const outputDir = path.resolve(cwd, args.output);

  if (!existsSync(inputDir)) {
    throw new Error(`Input directory does not exist: ${inputDir}`);
  }

  await mkdir(outputDir, { recursive: true });

  const commandArgs = ["-d", inputDir, "-o", outputDir];
  if (args.recursive) commandArgs.push("-r");

  console.log(`Converting NCM files from: ${inputDir}`);
  console.log(`Output directory: ${outputDir}`);
  await run(args.binary, commandArgs);
  const sidecarCount = await copySidecars(inputDir, outputDir);
  if (sidecarCount) {
    console.log(`Copied ${sidecarCount} sidecar file(s).`);
  }
  console.log("NCM conversion finished.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
