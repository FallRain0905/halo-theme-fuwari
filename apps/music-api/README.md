# FallRain Music API

Self-hosted API for the mobile music app and web music library.

## Environment

```bash
PORT=3100
MUSIC_API_TOKEN=change-this-token
MUSIC_API_DB=/opt/music-library/music.db
MUSIC_LIBRARY_JSON=/opt/music-library/public/songs.json
```

## Commands

```bash
pnpm --filter @fallrain/music-api start
pnpm --filter @fallrain/music-api sync
```

The service syncs `songs.json` into SQLite on startup and exposes `/music-api/*`
through your Nginx reverse proxy.
