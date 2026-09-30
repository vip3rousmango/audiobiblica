#!/bin/sh
# Apply an update on request, from outside the app.
#
# This is the only part of AudioBiblica that can touch Docker: it runs in its own
# container with the socket mounted, so the container serving the web interface
# stays unprivileged. It does one job — pull the published image and recreate the
# app container — and writes what it is doing into the shared control directory,
# which is how the app and the browser learn about progress.
#
# Files in the control directory (shared with the app as /control):
#   status.json          what this script is doing, plus a heartbeat
#   request.json         written by the app to ask for an update
#   request.running.json the claimed request, so a restart cannot apply it twice
set -eu

CONTROL="${AUDIOBIBLICA_CONTROL_DIR:-/control}"
PROJECT="${AUDIOBIBLICA_PROJECT_DIR:-/project}"
VERSION="${AUDIOBIBLICA_VERSION:-latest}"
COMPOSE_FILE="${PROJECT}/docker-compose.yml"

mkdir -p "$CONTROL"

compose() {
  docker compose -f "$COMPOSE_FILE" --project-directory "$PROJECT" "$@"
}

now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# Tiny JSON string escape: enough for versions, states and short log lines.
json_string() {
  printf '%s' "$1" | tr -d '\r' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n' ' '
}

write_status() {
  state="$1"
  message="$2"
  target="$3"
  started="$4"
  finished="$5"
  cat > "${CONTROL}/status.json.tmp" <<EOF
{"state": "$(json_string "$state")", "message": "$(json_string "$message")", "target": "$(json_string "$target")", "started_at": "$(json_string "$started")", "finished_at": "$(json_string "$finished")", "heartbeat": "$(now)", "pinned": "$([ "$VERSION" = latest ] && echo false || echo true)", "version": "$(json_string "$VERSION")"}
EOF
  mv "${CONTROL}/status.json.tmp" "${CONTROL}/status.json"
}

echo "AudioBiblica updater ready: project=${PROJECT} version=${VERSION}"

while true; do
  if [ -f "${CONTROL}/request.json" ]; then
    target="$(sed -n 's/.*"target"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${CONTROL}/request.json" | head -1)"
    [ -n "$target" ] || target="$VERSION"
    started="$(now)"

    # Claim the request before doing anything slow, so a restart mid-update does
    # not pick the same request up again.
    mv "${CONTROL}/request.json" "${CONTROL}/request.running.json"

    write_status "pulling" "Downloading version ${target}." "$target" "$started" ""

    if ! compose pull audiobiblica >"${CONTROL}/update.log" 2>&1; then
      write_status "error" "The new version could not be downloaded. $(tail -n 1 "${CONTROL}/update.log" 2>/dev/null)" "$target" "$started" "$(now)"
      mv "${CONTROL}/request.running.json" "${CONTROL}/request.failed.json" 2>/dev/null || true
      sleep 5
      continue
    fi

    write_status "recreating" "Starting version ${target}." "$target" "$started" ""

    # --no-deps and naming only the app: the updater must not recreate itself
    # while it is the process running this command.
    if ! compose up -d --no-deps audiobiblica >>"${CONTROL}/update.log" 2>&1; then
      write_status "error" "The new version could not be started. $(tail -n 1 "${CONTROL}/update.log" 2>/dev/null)" "$target" "$started" "$(now)"
      mv "${CONTROL}/request.running.json" "${CONTROL}/request.failed.json" 2>/dev/null || true
      sleep 5
      continue
    fi

    write_status "done" "Updated to ${target}." "$target" "$started" "$(now)"
    rm -f "${CONTROL}/request.running.json"
  else
    # No request: keep the heartbeat fresh so the app can tell the updater is
    # alive without having to guess from the socket.
    if [ ! -f "${CONTROL}/status.json" ]; then
      write_status "idle" "No update running." "" "" ""
    else
      last_state="$(sed -n 's/.*"state"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${CONTROL}/status.json" | head -1)"
      last_message="$(sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${CONTROL}/status.json" | head -1)"
      last_target="$(sed -n 's/.*"target"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${CONTROL}/status.json" | head -1)"
      last_started="$(sed -n 's/.*"started_at"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${CONTROL}/status.json" | head -1)"
      last_finished="$(sed -n 's/.*"finished_at"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${CONTROL}/status.json" | head -1)"
      write_status "${last_state:-idle}" "$last_message" "$last_target" "$last_started" "$last_finished"
    fi
  fi
  sleep 3
done
