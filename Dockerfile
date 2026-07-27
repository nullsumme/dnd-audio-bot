# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run check && npm run test:run && npm run build

FROM node:24-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS ytdlp
ARG YTDLP_VERSION=2026.07.04
ARG TARGETARCH
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl \
    && case "${TARGETARCH}" in \
      amd64) YTDLP_ASSET=yt-dlp_linux ;; \
      arm64) YTDLP_ASSET=yt-dlp_linux_aarch64 ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl --fail --location --show-error \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/${YTDLP_ASSET}" \
      --output /yt-dlp \
    && chmod 0755 /yt-dlp \
    && /yt-dlp --version \
    && rm -rf /var/lib/apt/lists/*

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
COPY --from=ytdlp /yt-dlp /usr/local/bin/yt-dlp

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    BODY_SIZE_LIMIT=256M \
    PROTOCOL_HEADER=x-forwarded-proto \
    HOST_HEADER=x-forwarded-host \
    DATA_DIR=/data \
    XDG_CACHE_HOME=/data/.cache

USER 10001:10001
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "build"]
