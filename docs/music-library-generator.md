# Music Library Generator

This helper scans local audio files and generates the JSON/static assets used by
the music library page.

It is intended for files you already have the right to process and publish. It
does not download songs from third-party music services or bypass platform
protection.

## Supported Input

- `.mp3`
- `.flac`
- `.m4a`
- `.ogg`
- `.wav`

The script reads embedded metadata when available:

- title
- artist
- album
- track number
- duration
- cover image
- lyrics

It also supports sidecar files with the same basename:

```text
music-source/
  Rock/
    Track 01.mp3
    Track 01.jpg
    Track 01.lrc
  Anime/
    Track 02.flac
```

Sidecar cover/lyric files take priority over embedded cover/lyrics.
The first-level folder becomes the music library section/category by default,
so this example generates `category: "Rock"` and `category: "Anime"`.

The generated playlist order is category -> album -> track number -> title.
If embedded track numbers are missing, a filename prefix such as `01 - Song.mp3`
is used as the track number.

## Default Workflow

Put audio files into `music-source/`, then run:

```powershell
pnpm.cmd music:generate -- --input music-source --clean
pnpm.cmd build:only
```

Output is written to:

```text
public/assets/music/library/
  songs.json
  songs/
  covers/
  lyrics/
```

After `pnpm build:only`, the deployable files are in:

```text
templates/assets/music/library/
```

Set the theme option "歌曲 JSON 地址" to:

```text
/themes/theme-fuwari/assets/music/library/songs.json
```

## Existing Audio URL Mode

If audio files are already hosted somewhere else and you only want to generate
metadata, use:

```powershell
pnpm.cmd music:generate -- --input music-source --no-copy-audio --audio-base "https://example.com/music" --clean
```

The script will generate audio URLs from the source file paths, for example:

```text
https://example.com/music/Album/Track%2001.mp3
```

## Server-Side Library Workflow

For large music libraries, keep audio files outside the theme and generate the
library directly on the server:

```bash
mkdir -p /opt/music-library/source /opt/music-library/public
```

Upload audio files to:

```text
/opt/music-library/source/
```

Generate or refresh the public library:

```bash
cd /opt/1panel/apps/halo/halo/data/themes/theme-fuwari
node scripts/generate-music-library.mjs \
  --input /opt/music-library/source \
  --output /opt/music-library/public \
  --public-base /music-library \
  --skip-existing
```

`--skip-existing` keeps already generated audio, cover, and lyric files instead
of rewriting them. `songs.json` is still refreshed every time.

If your source directory is organized as artist/album/song, use the album
folder as the page section with `--category-depth 2`, or disable folder
sections with `--category-depth 0`.

```bash
node scripts/generate-music-library.mjs \
  --input /opt/music-library/source \
  --output /opt/music-library/public \
  --public-base /music-library \
  --category-depth 2 \
  --skip-existing
```

Expose the generated files with Nginx:

```nginx
location /music-library/ {
    alias /opt/music-library/public/;
    add_header Access-Control-Allow-Origin * always;
}
```

Set the theme option "歌曲 JSON 地址" to:

```text
/music-library/songs.json
```

## Deploy

For the built-in theme asset workflow:

```powershell
scp -P 2595 -r .\templates .\settings.yaml .\i18n .\theme.yaml root@64.90.20.245:/opt/1panel/apps/halo/halo/data/themes/theme-fuwari/
```

For Halo attachments or object storage, upload the generated output directory
and set "歌曲 JSON 地址" to the uploaded `songs.json` URL.
