#!/usr/bin/env bash
set -Eeuo pipefail

# Move or delete temporary music processing folders after published media has
# been synced to COS. Defaults to dry-run so it is safe to inspect first.

MUSIC_ROOT="${MUSIC_ROOT:-/opt/music-library}"
HALO_THEME_DIR="${HALO_THEME_DIR:-/opt/1panel/apps/halo/halo/data/themes/theme-fuwari}"
ARCHIVE_ROOT="${ARCHIVE_ROOT:-/opt/cleanup-backup/fallrain}"
MODE="${MODE:-dry-run}" # dry-run | archive | delete
KEEP_PUBLIC="${KEEP_PUBLIC:-1}"

log() {
  printf '[%s] %s\n' "$(date '+%F %T')" "$*"
}

usage() {
  cat <<'EOF'
Usage:
  MODE=dry-run  scripts/cleanup-music-workspace.sh
  MODE=archive  scripts/cleanup-music-workspace.sh
  MODE=delete   scripts/cleanup-music-workspace.sh

Environment:
  MUSIC_ROOT      Default: /opt/music-library
  HALO_THEME_DIR  Default: /opt/1panel/apps/halo/halo/data/themes/theme-fuwari
  ARCHIVE_ROOT    Default: /opt/cleanup-backup/fallrain
  MODE            dry-run | archive | delete
  KEEP_PUBLIC     1 keeps /opt/music-library/public, 0 archives/deletes it too

The script never touches:
  - /opt/music-library/music.db
  - Halo attachments
  - COS objects
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

case "$MODE" in
  dry-run|archive|delete) ;;
  *)
    echo "Invalid MODE: $MODE" >&2
    usage
    exit 1
    ;;
esac

timestamp="$(date +%F-%H%M%S)"
archive_dir="$ARCHIVE_ROOT/music-workspace-$timestamp"

targets=(
  "$MUSIC_ROOT/ncm-source"
  "$MUSIC_ROOT/source"
  "$MUSIC_ROOT/work"
  "$MUSIC_ROOT/tmp"
  "$HALO_THEME_DIR/templates/assets/music"
  "$HALO_THEME_DIR/scripts/mp3"
)

if [[ "$KEEP_PUBLIC" != "1" ]]; then
  targets+=("$MUSIC_ROOT/public")
fi

log "Mode: $MODE"
log "Music root: $MUSIC_ROOT"
log "Halo theme dir: $HALO_THEME_DIR"
log "Archive root: $ARCHIVE_ROOT"
log "Keep public: $KEEP_PUBLIC"

existing=()
for target in "${targets[@]}"; do
  if [[ -e "$target" ]]; then
    existing+=("$target")
  fi
done

if (( ${#existing[@]} == 0 )); then
  log "No cleanup targets found"
  exit 0
fi

log "Cleanup candidates:"
for target in "${existing[@]}"; do
  du -sh "$target" 2>/dev/null || true
done

if [[ "$MODE" == "dry-run" ]]; then
  log "Dry run only. Re-run with MODE=archive or MODE=delete."
  exit 0
fi

if [[ "$MODE" == "archive" ]]; then
  mkdir -p "$archive_dir"
  for target in "${existing[@]}"; do
    rel="${target#/}"
    dest="$archive_dir/$rel"
    mkdir -p "$(dirname "$dest")"
    log "Move $target -> $dest"
    mv "$target" "$dest"
  done
  log "Archive complete: $archive_dir"
  du -sh "$archive_dir" || true
  exit 0
fi

if [[ "$MODE" == "delete" ]]; then
  for target in "${existing[@]}"; do
    log "Delete $target"
    rm -rf -- "$target"
  done
  log "Delete complete"
fi
