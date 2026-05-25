# Bilibili Audio Import

This workflow imports audio from Bilibili videos into the same music library
used by the Halo music page and the mobile app.

Use it only for videos/audio you have the right to archive or republish. The
generated page should keep attribution such as the source video title, uploader,
and original Bilibili URL where appropriate.

## Requirements

Install `yt-dlp` and `ffmpeg` on the machine that performs the import.

Windows:

```powershell
python -m pip install -U yt-dlp
winget install Gyan.FFmpeg
```

Ubuntu/Debian:

```bash
python3 -m pip install -U yt-dlp
apt update
apt install -y ffmpeg
```

If a video requires your own login state, export a cookies file and pass
`--cookies cookies.txt`, or use `--cookies-from-browser edge` locally.

## Single BV Import

Local test:

```powershell
pnpm bili:audio -- --bv BVxxxxxxxxxx --output .\music-source --category Bilibili --generate --public-output .\public\assets\music\library --public-base /themes/theme-fuwari/assets/music/library
```

Server import:

```bash
cd /opt/1panel/apps/halo/halo/data/themes/theme-fuwari
node scripts/download-bili-audio.mjs \
  --bv BVxxxxxxxxxx \
  --output /opt/music-library/source \
  --category Bilibili \
  --generate \
  --public-output /opt/music-library/public \
  --public-base /music-library \
  --sync-url http://127.0.0.1:3100/sync \
  --token "$MUSIC_API_TOKEN"
```

With the default `--category-depth 1`, the first-level folder becomes the page
category. For example, `--category 听力音频` produces `category: "听力音频"` in
`songs.json`.

## Batch Import

Create a text file:

```text
BVxxxxxxxxxx
https://www.bilibili.com/video/BVyyyyyyyyyy
```

Run:

```powershell
pnpm bili:audio -- --input .\bili-list.txt --category 听力音频 --output .\music-source --generate
```

Or start the local GUI:

```powershell
pnpm.cmd bili:gui
```

The GUI opens a local browser page at `http://127.0.0.1:3188`. Paste one BV id
or Bilibili video URL per line, choose a category, and click start. It calls the
same `download-bili-audio.mjs` script and writes logs to the page.

For a BV with multiple parts, enable `下载分集/合集` in the GUI, or pass
`--playlist` in the command line. Without this option, the downloader keeps the
default single-video behavior.

For large multi-part videos, fill `选集范围` in the GUI, or pass
`--playlist-items`:

```powershell
pnpm bili:audio -- --url https://www.bilibili.com/video/BVxxxxxxxxxx --playlist --playlist-items 1,3,8-12 --category course --generate
```

Common formats:

```text
1-5       # download item 1 to 5
1,3,8-12  # download item 1, item 3, and item 8 to 12
2:20:2    # download every 2nd item from 2 to 20
```

If you want all imported files under one category folder, enable `仅分类文件夹`,
or pass `--flat-category`:

```powershell
pnpm bili:audio -- --input .\bili-list.txt --category rock --flat-category --generate
```

This writes files like:

```text
music-source/
  rock/
    video-title [BVxxxx].mp3
```

JSON arrays are also supported:

```json
["BVxxxxxxxxxx", { "bv": "BVyyyyyyyyyy" }]
```

## Output Flow

The script writes downloaded audio to:

```text
/opt/music-library/source/<category>/<bilibili-uploader>/<video-title>.mp3
```

Then it can call:

```bash
node scripts/generate-music-library.mjs \
  --input /opt/music-library/source \
  --output /opt/music-library/public \
  --public-base /music-library \
  --category-depth 1 \
  --skip-existing
```

The web music page and mobile app keep reading:

```text
/music-library/songs.json
```

## Public Web Form

Do not expose raw download execution as an unauthenticated public endpoint. A
safe first version is:

- public users submit one BV at a time as a request;
- the server records the request or queues it;
- an admin-token job imports approved items;
- no batch download endpoint is provided to visitors.
