# syntax=docker/dockerfile:1.7

# The SvelteKit output is architecture-neutral; keep tests/build native during multi-platform releases.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run check && npm run test:run && npm run build

FROM node:24-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates ffmpeg tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 soundkeep \
    && useradd --uid 10001 --gid soundkeep --home-dir /app --shell /usr/sbin/nologin soundkeep \
    && mkdir -p /app /data \
    && chown -R soundkeep:soundkeep /app /data

WORKDIR /app
COPY --from=production-dependencies --chown=soundkeep:soundkeep /app/node_modules ./node_modules
COPY --from=build --chown=soundkeep:soundkeep /app/build ./build
COPY --from=build --chown=soundkeep:soundkeep /app/package.json ./package.json

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    BODY_SIZE_LIMIT=256M \
    DISCORD_OPUS_BITRATE_MODE=auto \
    PROTOCOL_HEADER=x-forwarded-proto \
    HOST_HEADER=x-forwarded-host \
    DATA_DIR=/data \
    MAX_UPLOAD_BYTES=262144000 \
    MAX_ARTWORK_BYTES=5242880 \
    MAX_LIBRARY_BYTES=8589934592 \
    MIN_FREE_BYTES=268435456 \
    MAX_CONCURRENT_UPLOADS=1 \
    MAX_PCM_CACHE_BYTES=67108864 \
    MAX_PCM_CACHE_ENTRY_BYTES=33554432 \
    ACTIVITY_LOG_CAPACITY=100 \
    XDG_CACHE_HOME=/data/.cache

USER 10001:10001
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "build"]
