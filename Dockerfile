# LogiTrack container image (optional: the npm workflow does not need Docker).
#
#   docker compose up --build        then open http://localhost:3000
#
# The SQLite database, backups and the generated app secret live in /data, which
# docker-compose.yml mounts as a named volume so they survive rebuilds.

# ---- Build -----------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Prisma's engines need OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# --ignore-scripts: nothing from the registry runs during install; Prisma is generated explicitly below.
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# node_modules is kept whole: the runtime needs tsx (runs server.ts) and the prisma CLI
# (applies migrations), which are dev dependencies. Simpler and safer than a partial prune.
RUN npx prisma generate && npx next build

# ---- Runtime ---------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME_BIND=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=file:/data/logitrack.db \
    BACKUP_DIR=/data/backups \
    ROUTING_PROVIDER=local \
    DEMO_MODE=true

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json /app/tsconfig.json /app/next.config.ts /app/server.ts ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=build --chown=node:node /app/prisma/migrations ./prisma/migrations
COPY --from=build --chown=node:node /app/prisma/seed.ts ./prisma/seed.ts
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/logitrack-entrypoint
RUN chmod 0755 /usr/local/bin/logitrack-entrypoint && mkdir -p /data && chown node:node /data

USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini forwards SIGTERM so the server shuts down cleanly (closes sockets, disconnects Prisma).
ENTRYPOINT ["/usr/bin/tini", "--", "logitrack-entrypoint"]
CMD ["npx", "tsx", "server.ts"]
