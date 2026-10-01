#!/usr/bin/env bash
# Install EasySchematic (the open-source drawing app) on this computer the way the studio console
# does: its app in Docker, its offline device library beside it. Lives beside easyschematic.py so
# the one copy ships in both the wheel and the container; served to the user at
# /api/v1/easyschematic/install-script and shown in the panel before anything runs.
#
# Guarantees, in order:
#   1. It first asks the machine whether an EasySchematic is already answering. If one is, it
#      prints that finding and exits 0 without installing anything — a second install is the one
#      thing this script must never do.
#   2. It clones into ~/EasySchematic only when that directory does not exist, and reuses an
#      existing checkout without touching its files.
#   3. Everything it starts (the library API, the app container) runs as this user's own services.
set -euo pipefail

SOURCE_DIR_DEFAULT="$HOME/EasySchematic"
SOURCE_DIR="${EASYSCHEMATIC_SOURCE_DIR:-$SOURCE_DIR_DEFAULT}"
REPOSITORY_URL="https://github.com/duremovich/EasySchematic.git"
RUNTIME_DIR="${EASYSCHEMATIC_RUNTIME_DIR:-$HOME/.audiobiblica/es-runtime}"
UI_PORT=8080
API_PORT=8787

say() { printf 'easyschematic-install: %s\n' "$*"; }

mkdir -p "$RUNTIME_DIR"

# -- 1. An EasySchematic already here? Then there is nothing to do. -----------------------------
# The answers are fetched to files and grepped there rather than through a pipeline: with
# `pipefail` on, a `grep -q` that closes the pipe mid-answer kills curl with SIGPIPE and the
# pipeline reads as failure — which is how an early version of this check walked straight past a
# running EasySchematic and cloned a second one.
already_running=0
if curl -fsS --max-time 3 -o "$RUNTIME_DIR/probe-ui.html" "http://127.0.0.1:${UI_PORT}/" 2>/dev/null     && grep -qi "easyschematic" "$RUNTIME_DIR/probe-ui.html"; then
    already_running=1
fi
if curl -fsS --max-time 3 -o "$RUNTIME_DIR/probe-templates.json" "http://127.0.0.1:${API_PORT}/templates" 2>/dev/null     && grep -q '"deviceType"' "$RUNTIME_DIR/probe-templates.json"; then
    already_running=1
fi
rm -f "$RUNTIME_DIR/probe-ui.html" "$RUNTIME_DIR/probe-templates.json"
if (( already_running )); then
    say "EasySchematic is already answering on this computer — nothing was installed or changed."
    say "Open http://localhost:${UI_PORT} to use it."
    exit 0
fi

# -- 2. Tools it needs. ---------------------------------------------------------------------------
missing=0
for command in git node npm docker; do
    if ! command -v "$command" >/dev/null 2>&1; then
        say "$command is required."
        missing=1
    fi
done
if ! docker compose version >/dev/null 2>&1; then
    say "Docker Compose is required (Docker Desktop includes it)."
    missing=1
fi
(( missing == 0 )) || exit 1

mkdir -p "$RUNTIME_DIR"

# -- 3. The source, cloned once and reused. -------------------------------------------------------
if [[ ! -e "$SOURCE_DIR" ]]; then
    say "Cloning EasySchematic into $SOURCE_DIR"
    git clone --depth 1 -- "$REPOSITORY_URL" "$SOURCE_DIR"
elif [[ ! -d "$SOURCE_DIR/package.json" ]] && [[ ! -f "$SOURCE_DIR/package.json" ]]; then
    say "$SOURCE_DIR exists but is not an EasySchematic checkout."
    exit 1
else
    say "Using the existing checkout at $SOURCE_DIR"
fi

# -- 4. Offline device library: dependencies, migrations, seed. ------------------------------------
if [[ ! -x "$SOURCE_DIR/api/node_modules/.bin/wrangler" ]]; then
    say "Installing the library's dependencies (a minute or two)"
    (cd "$SOURCE_DIR/api" && npm ci)
fi
say "Bringing the local device library up to date"
{ (cd "$SOURCE_DIR/api" && npm exec -- wrangler d1 migrations apply easyschematic-db --local) \
  && (cd "$SOURCE_DIR/api" && npm run seed:local); } >"$RUNTIME_DIR/api-seed.log" 2>&1 || {
    say "The device library could not be prepared; see $RUNTIME_DIR/api-seed.log"
    exit 1
}

# -- 5. The library API, as this user's background service. -----------------------------------------
library_answers() {
    curl -fsS --max-time 3 -o "$RUNTIME_DIR/probe-templates.json" "http://127.0.0.1:${API_PORT}/templates" 2>/dev/null \
        && grep -q '"deviceType"' "$RUNTIME_DIR/probe-templates.json"
}
if ! library_answers; then
    (cd "$SOURCE_DIR/api" && nohup npm run dev -- --local --ip 0.0.0.0 --port "$API_PORT" \
        >"$RUNTIME_DIR/api.log" 2>&1 & echo $! >"$RUNTIME_DIR/api.pid")
    say "Starting the device library on port $API_PORT"
    for _ in $(seq 1 40); do
        library_answers && break
        sleep 1
    done
fi
if ! library_answers; then
    say "The device library did not answer on port $API_PORT; see $RUNTIME_DIR/api.log"
    exit 1
fi
say "Device library ready on http://localhost:${API_PORT}"

# -- 6. The app image. Built from a clean copy of the checkout, because EasySchematic's own
#       .dockerignore excludes directories its own build needs (that is why the studio console
#       keeps a paired Dockerfile); a temp context with a deliberately narrow ignore file sidesteps
#       the whole trap without altering the checkout.
BUILD_DIR="$RUNTIME_DIR/ui-build"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
tar -C "$SOURCE_DIR" \
    --exclude=.git --exclude=node_modules --exclude='*/node_modules' \
    --exclude=dist --exclude=.wrangler --exclude="$BUILD_DIR" \
    -cf - . | tar -C "$BUILD_DIR" -xf -
cat >"$BUILD_DIR/Dockerfile" <<'DOCKERFILE'
# EasySchematic UI image, built by AudioBiblica's installer from a clean copy of the checkout.
# Upstream's own .dockerignore omits directories the TypeScript build imports through its tests,
# which is why this two-stage build runs against the copy above. Otherwise canonical.
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

FROM nginx:bookworm
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
DOCKERFILE
cat >"$BUILD_DIR/.dockerignore" <<'IGNORE'
**/node_modules
.git
dist
.wrangler
.env*
.dev.vars
IGNORE
say "Building the EasySchematic app image (the first build takes a few minutes)"
docker build --file "$BUILD_DIR/Dockerfile" --tag easyschematic-ui:local "$BUILD_DIR" \
    >"$RUNTIME_DIR/ui-build.log" 2>&1 || {
    say "The app image could not be built; see $RUNTIME_DIR/ui-build.log"
    exit 1
}

# -- 7. The app, as a container. -------------------------------------------------------------------
cat >"$RUNTIME_DIR/compose.yml" <<COMPOSE
# Written by AudioBiblica's installer; the studio console's bundle runs the same shape.
services:
  easyschematic:
    image: easyschematic-ui:local
    ports:
      - "${UI_PORT}:80"
    restart: unless-stopped
COMPOSE
docker compose --file "$RUNTIME_DIR/compose.yml" --project-name easyschematic up --detach easyschematic \
    >"$RUNTIME_DIR/ui.log" 2>&1 || {
    say "The app container could not be started; see $RUNTIME_DIR/ui.log"
    exit 1
}

say "EasySchematic is installed and running."
say "App:            http://localhost:${UI_PORT}  (open this one)"
say "Device library: http://localhost:${API_PORT}"
say "To import devices from AudioBiblica, open the app and use its device Import with the JSON the AudioBiblica panel downloads."