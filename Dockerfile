# ---- build stage: compiles the web app (Vite) and the server (tsc) ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install root deps (server) — also builds native canvas/better-sqlite3.
COPY package*.json ./
RUN npm ci

# Install web deps separately so the layer caches on lockfile changes.
COPY web/package*.json ./web/
RUN npm --prefix web ci

# Build everything: `npm run build` runs the web Vite build then `tsc`.
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime stage ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Runtime system packages:
#  - node-canvas shared libs (overlay rendering)
#  - iputils-ping: device reachability shells out to `ping` (online badge / ping / show-next)
#  - libnss-mdns: resolve *.local frame hosts (mDNS). Prefer IP addresses if this is unreliable.
#  - ca-certificates: HTTPS to Immich / GitHub firmware / Telegram / OAuth
RUN apt-get update && apt-get install -y --no-install-recommends \
      libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 libpixman-1-0 librsvg2-2 \
      iputils-ping libnss-mdns ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist

ENV PORT=8080 \
    CACHE_DIR=/data/cache \
    SETTINGS_FILE=/data/settings.json \
    DB_FILE=/data/app.db \
    WEB_DIST_DIR=/app/web/dist
EXPOSE 8080
VOLUME ["/data"]
CMD ["node", "dist/index.js"]
