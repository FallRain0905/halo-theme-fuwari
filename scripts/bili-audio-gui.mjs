#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const cwd = process.cwd();
const jobs = new Map();

function parseArgs(argv) {
  const args = {
    host: "127.0.0.1",
    port: 3188,
    open: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--") {
      continue;
    } else if (arg === "--host") {
      args.host = next;
      i += 1;
    } else if (arg === "--port" || arg === "-p") {
      args.port = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--no-open") {
      args.open = false;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.port) || args.port <= 0) {
    throw new Error("--port must be a valid port number.");
  }
  return args;
}

function printHelp() {
  console.log(`Start a local GUI for batch Bilibili audio import.

Usage:
  pnpm bili:gui
  node scripts/bili-audio-gui.mjs --port 3188

Options:
      --host <host>  Bind host. Default: 127.0.0.1
  -p, --port <port>  Bind port. Default: 3188
      --no-open      Do not open the browser automatically.
  -h, --help         Show this help.
`);
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendHtml(res) {
  const body = getHtml();
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function appendLog(job, text) {
  job.log += text;
  if (job.log.length > 250000) {
    job.log = job.log.slice(-200000);
  }
}

function normalizeItems(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function optionalString(value) {
  return String(value || "").trim();
}

async function createJob(payload) {
  const items = normalizeItems(payload.items);
  if (!items.length) {
    throw new Error("Please enter at least one BV id or Bilibili video URL.");
  }

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tempDir = path.join(os.tmpdir(), `fallrain-bili-gui-${id}`);
  const inputFile = path.join(tempDir, "bili-list.txt");
  await mkdir(tempDir, { recursive: true });
  await writeFile(inputFile, `${items.join("\n")}\n`, "utf8");

  const job = {
    id,
    status: "running",
    code: null,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    log: "",
    tempDir,
  };
  jobs.set(id, job);

  const script = path.join(cwd, "scripts", "download-bili-audio.mjs");
  const childArgs = [
    script,
    "--input",
    inputFile,
    "--output",
    optionalString(payload.output) || "music-source",
    "--category",
    optionalString(payload.category) || "Bilibili",
    "--format",
    optionalString(payload.format) || "mp3",
  ];

  if (payload.generate !== false) {
    childArgs.push(
      "--generate",
      "--public-output",
      optionalString(payload.publicOutput) || "public/assets/music/library",
      "--public-base",
      optionalString(payload.publicBase) ||
        "/themes/theme-fuwari/assets/music/library",
      "--generate-input",
      optionalString(payload.generateInput) ||
        optionalString(payload.output) ||
        "music-source",
      "--category-depth",
      String(
        Number.isFinite(Number(payload.categoryDepth))
          ? payload.categoryDepth
          : 1,
      ),
    );
  }

  if (payload.playlist) childArgs.push("--playlist");
  if (payload.playlistItems) {
    childArgs.push("--playlist-items", optionalString(payload.playlistItems));
  }
  if (payload.flatCategory) childArgs.push("--flat-category");
  if (payload.overwrite) childArgs.push("--overwrite");
  if (payload.cleanPublic) childArgs.push("--clean-public");
  if (payload.noEmbedMetadata) childArgs.push("--no-embed-metadata");
  if (payload.cookies)
    childArgs.push("--cookies", optionalString(payload.cookies));
  if (payload.cookiesFromBrowser) {
    childArgs.push(
      "--cookies-from-browser",
      optionalString(payload.cookiesFromBrowser),
    );
  }
  if (payload.ffmpegLocation) {
    childArgs.push("--ffmpeg-location", optionalString(payload.ffmpegLocation));
  }
  if (payload.proxy) childArgs.push("--proxy", optionalString(payload.proxy));
  if (payload.syncUrl)
    childArgs.push("--sync-url", optionalString(payload.syncUrl));
  if (payload.token) childArgs.push("--token", optionalString(payload.token));

  appendLog(job, `node ${childArgs.map(quoteArg).join(" ")}\n\n`);
  const child = spawn(process.execPath, childArgs, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => appendLog(job, chunk));
  child.stderr.on("data", (chunk) => appendLog(job, chunk));
  child.on("error", (error) => {
    job.status = "failed";
    job.finishedAt = new Date().toISOString();
    appendLog(job, `\n${error.message}\n`);
    cleanupJob(job);
  });
  child.on("exit", (code) => {
    job.code = code;
    job.status = code === 0 ? "done" : "failed";
    job.finishedAt = new Date().toISOString();
    appendLog(job, `\nProcess exited with code ${code}.\n`);
    cleanupJob(job);
  });

  return job;
}

function quoteArg(value) {
  const text = String(value);
  if (!/[\s"'`]/.test(text)) return text;
  return JSON.stringify(text);
}

async function cleanupJob(job) {
  if (!job.tempDir) return;
  await rm(job.tempDir, { recursive: true, force: true }).catch(() => {});
}

function openBrowser(url) {
  const command =
    process.platform === "win32"
      ? "cmd"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    shell: false,
  });
  child.unref();
}

function getHtml() {
  return String.raw`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Bilibili 音频导入</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #101114;
        --panel: #191b20;
        --panel-2: #22252c;
        --text: #f4f4f5;
        --muted: #a1a1aa;
        --line: #343741;
        --accent: #ff5c7a;
        --ok: #4ade80;
        --bad: #fb7185;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background: var(--bg);
        color: var(--text);
        font-family: Inter, "Segoe UI", "Microsoft YaHei", sans-serif;
      }
      main {
        width: min(1180px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 28px 0 36px;
      }
      header {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 18px;
        margin-bottom: 18px;
      }
      h1 {
        margin: 0;
        font-size: 28px;
        letter-spacing: 0;
      }
      .hint {
        margin: 8px 0 0;
        color: var(--muted);
        line-height: 1.6;
      }
      .grid {
        display: grid;
        grid-template-columns: minmax(0, 1.05fr) minmax(360px, 0.95fr);
        gap: 16px;
      }
      section {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 18px;
      }
      label {
        display: block;
        margin: 0 0 8px;
        color: #e4e4e7;
        font-weight: 700;
      }
      input, textarea, select {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #0f1013;
        color: var(--text);
        padding: 11px 12px;
        font: inherit;
        outline: none;
      }
      input:focus, textarea:focus, select:focus {
        border-color: var(--accent);
      }
      textarea {
        min-height: 238px;
        resize: vertical;
        line-height: 1.5;
        font-family: "JetBrains Mono", Consolas, monospace;
      }
      .row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-top: 14px;
      }
      .check-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 14px;
      }
      .check {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 9px 11px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--panel-2);
        color: var(--muted);
        font-weight: 700;
      }
      .check input {
        width: 16px;
        height: 16px;
        accent-color: var(--accent);
      }
      .actions {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 18px;
      }
      button {
        border: 0;
        border-radius: 9px;
        background: var(--accent);
        color: white;
        padding: 12px 18px;
        font: inherit;
        font-weight: 800;
        cursor: pointer;
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      .secondary {
        background: var(--panel-2);
        color: var(--text);
      }
      .status {
        color: var(--muted);
        font-weight: 700;
      }
      .status.done { color: var(--ok); }
      .status.failed { color: var(--bad); }
      pre {
        min-height: 560px;
        max-height: 72vh;
        margin: 0;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        border-radius: 8px;
        background: #090a0d;
        border: 1px solid var(--line);
        padding: 14px;
        color: #e5e7eb;
        font: 13px/1.55 "JetBrains Mono", Consolas, monospace;
      }
      .small {
        margin-top: 8px;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
      }
      @media (max-width: 900px) {
        main { width: min(100vw - 20px, 720px); }
        header, .grid { display: block; }
        section { margin-top: 14px; }
        .row { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>Bilibili 音频批量导入</h1>
          <p class="hint">输入 BV 号或视频链接，一行一个。任务在本机执行，输出到现有音乐馆目录。</p>
        </div>
        <div class="status" id="status">待开始</div>
      </header>
      <div class="grid">
        <section>
          <label for="items">BV / URL 列表</label>
          <textarea id="items" placeholder="BV1BB4y1k7o1&#10;https://www.bilibili.com/video/BVxxxxxxxxxx"></textarea>
          <div class="row">
            <div>
              <label for="category">分类</label>
              <input id="category" value="Bilibili" />
            </div>
            <div>
              <label for="format">音频格式</label>
              <select id="format">
                <option value="mp3" selected>mp3</option>
                <option value="m4a">m4a</option>
                <option value="opus">opus</option>
                <option value="flac">flac</option>
                <option value="wav">wav</option>
              </select>
            </div>
          </div>
          <div class="row">
            <div>
              <label for="output">音频源目录</label>
              <input id="output" value="music-source" />
            </div>
            <div>
              <label for="publicOutput">生成目录</label>
              <input id="publicOutput" value="public/assets/music/library" />
            </div>
          </div>
          <div class="row">
            <div>
              <label for="publicBase">Public Base</label>
              <input id="publicBase" value="/themes/theme-fuwari/assets/music/library" />
            </div>
            <div>
              <label for="categoryDepth">分类层级</label>
              <input id="categoryDepth" type="number" min="0" value="1" />
            </div>
          </div>
          <div class="row">
            <div>
              <label for="cookiesFromBrowser">浏览器 Cookies</label>
              <input id="cookiesFromBrowser" placeholder="edge / chrome，可留空" />
            </div>
            <div>
              <label for="cookies">Cookies 文件</label>
              <input id="cookies" placeholder="C:\path\to\cookies.txt，可留空" />
            </div>
          </div>
          <div class="row">
            <div>
              <label for="playlistItems">选集范围</label>
              <input id="playlistItems" placeholder="例如 1-5 或 1,3,8-12；留空则全部" />
            </div>
            <div>
              <label for="ffmpegLocation">FFmpeg 目录</label>
              <input id="ffmpegLocation" placeholder="可留空，默认读取 PATH" />
            </div>
          </div>
          <div class="row">
            <div>
              <label for="proxy">代理</label>
              <input id="proxy" placeholder="http://127.0.0.1:7890，可留空" />
            </div>
            <div>
              <label for="syncUrl">Music API Sync URL</label>
              <input id="syncUrl" placeholder="本地测试可留空" />
            </div>
          </div>
          <div class="row">
            <div>
              <label for="token">Music API Token</label>
              <input id="token" type="password" placeholder="本地测试可留空" />
            </div>
            <div></div>
          </div>
          <div class="check-row">
            <label class="check"><input id="generate" type="checkbox" checked />生成 songs.json</label>
            <label class="check"><input id="playlist" type="checkbox" />下载分集/合集</label>
            <label class="check"><input id="flatCategory" type="checkbox" />仅分类文件夹</label>
            <label class="check"><input id="overwrite" type="checkbox" />覆盖已有文件</label>
            <label class="check"><input id="cleanPublic" type="checkbox" />清空生成目录</label>
            <label class="check"><input id="noEmbedMetadata" type="checkbox" />不嵌入元数据</label>
          </div>
          <div class="actions">
            <button id="start">开始导入</button>
            <button class="secondary" id="clear" type="button">清空日志</button>
          </div>
          <p class="small">本地批量导入建议先用默认目录测试。要导入服务器，请在服务器运行同一脚本，或后续再接入后台队列。</p>
        </section>
        <section>
          <label>执行日志</label>
          <pre id="log"></pre>
        </section>
      </div>
    </main>
    <script>
      const $ = (id) => document.getElementById(id);
      let currentJob = "";
      let timer = 0;

      function readPayload() {
        return {
          items: $("items").value,
          category: $("category").value,
          format: $("format").value,
          output: $("output").value,
          publicOutput: $("publicOutput").value,
          publicBase: $("publicBase").value,
          categoryDepth: Number($("categoryDepth").value || 1),
          cookiesFromBrowser: $("cookiesFromBrowser").value,
          cookies: $("cookies").value,
          playlistItems: $("playlistItems").value,
          ffmpegLocation: $("ffmpegLocation").value,
          proxy: $("proxy").value,
          syncUrl: $("syncUrl").value,
          token: $("token").value,
          generate: $("generate").checked,
          playlist: $("playlist").checked,
          flatCategory: $("flatCategory").checked,
          overwrite: $("overwrite").checked,
          cleanPublic: $("cleanPublic").checked,
          noEmbedMetadata: $("noEmbedMetadata").checked,
        };
      }

      function setStatus(text, cls = "") {
        const el = $("status");
        el.textContent = text;
        el.className = "status " + cls;
      }

      async function poll() {
        if (!currentJob) return;
        const res = await fetch("/api/jobs/" + encodeURIComponent(currentJob));
        const job = await res.json();
        $("log").textContent = job.log || "";
        $("log").scrollTop = $("log").scrollHeight;
        if (job.status === "running") {
          setStatus("运行中");
          return;
        }
        clearInterval(timer);
        timer = 0;
        $("start").disabled = false;
        setStatus(job.status === "done" ? "完成" : "失败", job.status);
      }

      $("start").addEventListener("click", async () => {
        $("start").disabled = true;
        $("log").textContent = "";
        setStatus("启动中");
        try {
          const res = await fetch("/api/jobs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(readPayload()),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "启动失败");
          currentJob = data.id;
          await poll();
          clearInterval(timer);
          timer = setInterval(poll, 1000);
        } catch (error) {
          $("start").disabled = false;
          setStatus("失败", "failed");
          $("log").textContent = error.message;
        }
      });

      $("clear").addEventListener("click", () => {
        $("log").textContent = "";
      });
    </script>
  </body>
</html>`;
}

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/") {
      sendHtml(res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/jobs") {
      const payload = JSON.parse(await readBody(req));
      const job = await createJob(payload);
      sendJson(res, 200, { id: job.id, status: job.status });
      return;
    }
    const match = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (req.method === "GET" && match) {
      const job = jobs.get(decodeURIComponent(match[1]));
      if (!job) {
        sendJson(res, 404, { error: "Job not found." });
        return;
      }
      sendJson(res, 200, {
        id: job.id,
        status: job.status,
        code: job.code,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        log: job.log,
      });
      return;
    }
    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

const args = parseArgs(process.argv.slice(2));
const server = createServer((req, res) => {
  handleRequest(req, res);
});

server.listen(args.port, args.host, () => {
  const url = `http://${args.host}:${args.port}`;
  console.log(`Bilibili audio GUI: ${url}`);
  console.log("Press Ctrl+C to stop.");
  if (args.open) openBrowser(url);
});
