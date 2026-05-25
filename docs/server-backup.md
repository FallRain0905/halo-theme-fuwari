# FallRain Server Backup

This project is a Halo site plus a custom music service. Backups are split by
responsibility:

- GitHub keeps source code, scripts, and documentation.
- COS keeps published media and compressed migration backups.
- The server keeps runtime data and can be recreated from the backup set.

## Backup Script

Upload `scripts/backup-fallrain.sh` to the server and run:

```bash
chmod +x scripts/backup-fallrain.sh
BACKUP_PASSPHRASE='change-this-passphrase' scripts/backup-fallrain.sh
```

Default paths:

```text
HALO_ROOT=/opt/1panel/apps/halo/halo
MUSIC_ROOT=/opt/music-library
BACKUP_ROOT=/opt/backups/fallrain
COS_BACKUP_URI=cos://fallrain/backups
COS_MUSIC_URI=cos://fallrain/music-library
```

Generated backup files:

```text
halo-data.tar.gz          Halo data, attachments, plugins, themes
runtime-config.tar.gz     Nginx config and docker-compose.yml
music-state.tar.gz        music.db and songs.json
secrets.tar.gz.gpg        encrypted .env, systemd service, COS credentials
MANIFEST.txt              paths and backup metadata
SHA256SUMS                checksum file
```

Large historical music files inside the theme are excluded:

```text
data/themes/theme-fuwari/templates/assets/music
data/themes/theme-fuwari/scripts/mp3
```

Published media is synchronized separately:

```bash
coscli sync /opt/music-library/public/ cos://fallrain/music-library/ -r
```

## Cleanup Script

Inspect cleanup candidates:

```bash
chmod +x scripts/cleanup-music-workspace.sh
MODE=dry-run scripts/cleanup-music-workspace.sh
```

Move temporary processing files into `/opt/cleanup-backup/fallrain`:

```bash
MODE=archive scripts/cleanup-music-workspace.sh
```

Delete temporary processing files directly:

```bash
MODE=delete scripts/cleanup-music-workspace.sh
```

By default the cleanup script keeps:

```text
/opt/music-library/public
/opt/music-library/music.db
Halo attachments
COS objects
```

It targets only temporary or historical copies:

```text
/opt/music-library/ncm-source
/opt/music-library/source
/opt/music-library/work
/opt/music-library/tmp
/opt/1panel/apps/halo/halo/data/themes/theme-fuwari/templates/assets/music
/opt/1panel/apps/halo/halo/data/themes/theme-fuwari/scripts/mp3
```

## Restore Outline

On a new server:

1. Install Docker, Nginx, Node.js/pnpm, and coscli.
2. Restore `halo-data.tar.gz` under `/opt/1panel/apps/halo/halo`.
3. Restore `runtime-config.tar.gz`.
4. Decrypt `secrets.tar.gz.gpg` and restore `.env`, systemd service, and COS credentials.
5. Pull published media from COS:

```bash
coscli sync cos://fallrain/music-library/ /opt/music-library/public/ -r
```

6. Start Halo, Nginx, and `fallrain-music-api`.
7. Verify:

```bash
curl https://blog.fallrain0905.top/music-api/health
curl -I https://blog.fallrain0905.top/music-library/songs.json
```
