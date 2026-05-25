# MV Library Workflow

This workflow keeps MV videos separate from the existing music library. It does
not modify `songs.json`.

Use it only for videos you have the right to archive or republish. Public pages
should keep attribution such as the original Bilibili URL and uploader.

## Directory Layout

Recommended server layout:

```text
/opt/mv-library/
  source/
  public/
    videos/
    covers/
    mv.json
```

Expose the public directory with Nginx:

```nginx
location /mv-library/ {
    alias /opt/mv-library/public/;
    add_header Access-Control-Allow-Origin * always;
}
```

The future MV page should read:

```text
/mv-library/mv.json
```

## Requirements

Install `yt-dlp` and `ffmpeg` on the machine that downloads videos.

Ubuntu/Debian:

```bash
python3 -m pip install -U yt-dlp
apt update
apt install -y ffmpeg
```

Windows:

```powershell
python -m pip install -U yt-dlp
winget install Gyan.FFmpeg
```

## Download One MV

Server:

```bash
cd /opt/1panel/apps/halo/halo/data/themes/theme-fuwari
node scripts/download-bili-video.mjs \
  --bv BVxxxxxxxxxx \
  --output /opt/mv-library/source \
  --category rock \
  --quality 1080 \
  --generate \
  --public-output /opt/mv-library/public \
  --public-base /mv-library
```

Local test:

```powershell
pnpm.cmd bili:video -- --bv BVxxxxxxxxxx --output .\mv-source --category rock --generate --public-output .\public\assets\mv\library --public-base /themes/theme-fuwari/assets/mv/library
```

Quality presets:

```bash
--quality best   # best available
--quality 1080   # best format up to 1080p
--quality 720    # best format up to 720p
```

Supported presets are `best`, `2160`, `1440`, `1080`, `720`, `480`, and `360`.
Higher quality may require your own Bilibili login cookies. For advanced yt-dlp
usage, `--format-selector` overrides `--quality`.

## Multi-Part And Selected Parts

Download all parts:

```bash
node scripts/download-bili-video.mjs \
  --url https://www.bilibili.com/video/BVxxxxxxxxxx \
  --playlist \
  --output /opt/mv-library/source \
  --category live \
  --generate \
  --public-output /opt/mv-library/public \
  --public-base /mv-library
```

Download selected parts only:

```bash
node scripts/download-bili-video.mjs \
  --url https://www.bilibili.com/video/BVxxxxxxxxxx \
  --playlist \
  --playlist-items 1,3,8-12 \
  --output /opt/mv-library/source \
  --category live \
  --generate \
  --public-output /opt/mv-library/public \
  --public-base /mv-library
```

Common `--playlist-items` formats:

```text
1-5       # item 1 to 5
1,3,8-12  # item 1, item 3, and item 8 to 12
2:20:2    # every 2nd item from 2 to 20
```

## Flat Category Output

By default files are saved under:

```text
/opt/mv-library/source/<category>/<uploader>/<title> [BVxxxx].mp4
```

To put all videos directly under the category folder:

```bash
node scripts/download-bili-video.mjs \
  --bv BVxxxxxxxxxx \
  --category rock \
  --flat-category \
  --output /opt/mv-library/source
```

This writes:

```text
/opt/mv-library/source/rock/<title> [BVxxxx].mp4
```

## Generate mv.json Only

If videos already exist in `/opt/mv-library/source`, regenerate the public
library:

```bash
cd /opt/1panel/apps/halo/halo/data/themes/theme-fuwari
node scripts/generate-mv-library.mjs \
  --input /opt/mv-library/source \
  --output /opt/mv-library/public \
  --public-base /mv-library \
  --category-depth 1 \
  --skip-existing
```

Generated shape:

```json
[
  {
    "id": "bili-BVxxxxxxxxxx",
    "title": "MV title",
    "artist": "Uploader",
    "category": "rock",
    "cover": "/mv-library/covers/uploader-title.jpg",
    "url": "/mv-library/videos/uploader-title.mp4",
    "source": "https://www.bilibili.com/video/BVxxxxxxxxxx",
    "bvid": "BVxxxxxxxxxx",
    "duration": "4:32",
    "description": "..."
  }
]
```

## Next Step

After `mv.json` is stable, add a management UI for binding songs to MV items.
Keep the binding separate from `songs.json`, for example:

```text
/opt/mv-library/public/song-mv-map.json
```

## Faststart Optimization

For faster browser startup and more reliable seeking, optimize downloaded MP4
files before generating `mv.json`:

```bash
cd /opt/1panel/apps/halo/halo/data/themes/theme-fuwari
node scripts/optimize-mv-library.mjs \
  --input /opt/mv-library/source \
  --output /opt/mv-library/optimized
```

This does not transcode or reduce quality. It runs:

```bash
ffmpeg -i input.mp4 -map 0 -c copy -movflags +faststart output.mp4
```

Then generate `mv.json` from the optimized directory:

```bash
node scripts/generate-mv-library.mjs \
  --input /opt/mv-library/optimized \
  --output /opt/mv-library/public \
  --public-base /mv-library \
  --category-depth 1 \
  --skip-existing
```

Recommended first-pass flow:

```text
download-bili-video.mjs -> optimize-mv-library.mjs -> generate-mv-library.mjs
```

## Server WebUI

The MV downloader can be controlled from a local/server browser page:

```bash
cd /opt/1panel/apps/halo/halo/data/themes/theme-fuwari
MEDIA_ADMIN_TOKEN='change-this-token' \
HOST=127.0.0.1 \
PORT=3200 \
node scripts/bili-video-gui.mjs --no-open
```

Local test on Windows:

```powershell
pnpm.cmd bili:video-gui
```

Then open:

```text
http://127.0.0.1:3200
```

If `MEDIA_ADMIN_TOKEN` or `--token` is set, fill the same token in the WebUI.
The browser stores it in localStorage and sends it as a Bearer token to the job
APIs.

Recommended Nginx proxy:

```nginx
location /media-admin/ {
    proxy_pass http://127.0.0.1:3200/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 3600s;
}
```

For public internet access, add Nginx basic auth or only allow your own IP.
Do not expose this WebUI without authentication.
