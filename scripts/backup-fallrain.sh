#!/usr/bin/env bash
set -Eeuo pipefail

# Migration-grade backup for the FallRain Halo + music stack.
# Intended to run on the server. Large media is synchronized to COS separately.

HALO_ROOT="${HALO_ROOT:-/opt/1panel/apps/halo/halo}"
HALO_DATA="${HALO_DATA:-$HALO_ROOT/data}"
MUSIC_ROOT="${MUSIC_ROOT:-/opt/music-library}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/backups/fallrain}"
COS_BACKUP_URI="${COS_BACKUP_URI:-cos://fallrain/backups}"
COS_MUSIC_URI="${COS_MUSIC_URI:-cos://fallrain/music-library}"
RETENTION="${RETENTION:-7}"
SYNC_MUSIC_TO_COS="${SYNC_MUSIC_TO_COS:-1}"
UPLOAD_BACKUP_TO_COS="${UPLOAD_BACKUP_TO_COS:-1}"
INCLUDE_SECRETS="${INCLUDE_SECRETS:-1}"

timestamp="$(date +%F-%H%M%S)"
backup_dir="$BACKUP_ROOT/$timestamp"
manifest="$backup_dir/MANIFEST.txt"

log() {
  printf '[%s] %s\n' "$(date '+%F %T')" "$*"
}

require_dir() {
  if [[ ! -d "$1" ]]; then
    printf 'Required directory not found: %s\n' "$1" >&2
    exit 1
  fi
}

tar_existing() {
  local output="$1"
  shift
  local files=()
  local item
  for item in "$@"; do
    if [[ -e "$item" ]]; then
      files+=("$item")
    fi
  done
  if (( ${#files[@]} == 0 )); then
    log "Skip $output: no matching files"
    return 0
  fi
  tar -czf "$output" "${files[@]}"
}

cleanup_old_backups() {
  [[ "$RETENTION" =~ ^[0-9]+$ ]] || return 0
  (( RETENTION > 0 )) || return 0
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' |
    sort -rn |
    awk -v keep="$RETENTION" 'NR > keep {print $2}' |
    while IFS= read -r old_dir; do
      [[ -n "$old_dir" ]] || continue
      log "Remove old local backup: $old_dir"
      rm -rf -- "$old_dir"
    done
}

require_dir "$HALO_DATA"
mkdir -p "$backup_dir"

log "Backup directory: $backup_dir"
{
  echo "FallRain backup manifest"
  echo "Created at: $(date -Is)"
  echo "Host: $(hostname)"
  echo
  echo "HALO_ROOT=$HALO_ROOT"
  echo "HALO_DATA=$HALO_DATA"
  echo "MUSIC_ROOT=$MUSIC_ROOT"
  echo "COS_BACKUP_URI=$COS_BACKUP_URI"
  echo "COS_MUSIC_URI=$COS_MUSIC_URI"
} > "$manifest"

if [[ "$SYNC_MUSIC_TO_COS" == "1" ]]; then
  if command -v coscli >/dev/null 2>&1 && [[ -d "$MUSIC_ROOT/public" ]]; then
    log "Sync published music library to COS"
    coscli sync "$MUSIC_ROOT/public/" "$COS_MUSIC_URI/" -r
  else
    log "Skip music COS sync: coscli or $MUSIC_ROOT/public missing"
  fi
fi

log "Create halo-data.tar.gz"
tar -czf "$backup_dir/halo-data.tar.gz" \
  -C "$HALO_ROOT" \
  --exclude='data/backups/*' \
  --exclude='data/logs/*' \
  --exclude='data/themes/theme-fuwari/node_modules' \
  --exclude='data/themes/theme-fuwari/.git' \
  --exclude='data/themes/theme-fuwari/templates/assets/music' \
  --exclude='data/themes/theme-fuwari/scripts/mp3' \
  data

log "Create runtime-config.tar.gz"
tar_existing "$backup_dir/runtime-config.tar.gz" \
  /etc/nginx/nginx.conf \
  /etc/nginx/sites-available \
  /etc/nginx/sites-enabled \
  "$HALO_ROOT/docker-compose.yml"

log "Create music-state.tar.gz"
tar_existing "$backup_dir/music-state.tar.gz" \
  "$MUSIC_ROOT/music.db" \
  "$MUSIC_ROOT/public/songs.json"

if [[ "$INCLUDE_SECRETS" == "1" ]]; then
  secret_tmp="$backup_dir/secrets.tar.gz"
  log "Create encrypted secrets archive"
  tar_existing "$secret_tmp" \
    "$HALO_ROOT/.env" \
    /etc/systemd/system/fallrain-music-api.service \
    /etc/passwd-cosfs \
    "$HOME/.cos.yaml"

  if [[ -f "$secret_tmp" ]]; then
    if [[ -z "${BACKUP_PASSPHRASE:-}" ]]; then
      log "BACKUP_PASSPHRASE is empty; keep secrets.tar.gz local only and do not upload it"
      echo "WARNING: secrets.tar.gz is not encrypted and will not be uploaded." >> "$manifest"
    else
      gpg --batch --yes --passphrase "$BACKUP_PASSPHRASE" \
        -c --cipher-algo AES256 \
        -o "$backup_dir/secrets.tar.gz.gpg" "$secret_tmp"
      rm -f "$secret_tmp"
      echo "Encrypted secrets: secrets.tar.gz.gpg" >> "$manifest"
    fi
  fi
fi

log "Write checksums"
(
  cd "$backup_dir"
  sha256sum *.tar.gz *.tar.gz.gpg 2>/dev/null || true
) > "$backup_dir/SHA256SUMS"

if [[ "$UPLOAD_BACKUP_TO_COS" == "1" ]]; then
  if command -v coscli >/dev/null 2>&1; then
    upload_tmp="$backup_dir/.upload"
    rm -rf "$upload_tmp"
    mkdir -p "$upload_tmp"
    cp "$backup_dir"/MANIFEST.txt "$backup_dir"/SHA256SUMS "$upload_tmp"/
    cp "$backup_dir"/halo-data.tar.gz "$backup_dir"/runtime-config.tar.gz "$backup_dir"/music-state.tar.gz "$upload_tmp"/ 2>/dev/null || true
    cp "$backup_dir"/secrets.tar.gz.gpg "$upload_tmp"/ 2>/dev/null || true
    log "Upload backup to COS: $COS_BACKUP_URI/$timestamp/"
    coscli sync "$upload_tmp/" "$COS_BACKUP_URI/$timestamp/" -r
    rm -rf "$upload_tmp"
  else
    log "Skip backup COS upload: coscli not found"
  fi
fi

cleanup_old_backups

log "Backup complete"
du -sh "$backup_dir" || true
