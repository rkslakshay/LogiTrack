#!/bin/sh
# Container start-up: back up before upgrading the schema, apply migrations, seed
# demo data only into an empty database when asked, then start the server.
set -eu

DB_FILE="${DATABASE_URL#file:}"
mkdir -p "$(dirname "$DB_FILE")" "${BACKUP_DIR:-/data/backups}"

if [ -s "$DB_FILE" ]; then
  # `migrate status` exits non-zero when migrations are pending: keep a verified copy first.
  if ! npx prisma migrate status >/dev/null 2>&1; then
    echo "[entrypoint] Pending database migrations: creating a backup first"
    npx tsx scripts/db.ts backup pre-migrate
  fi
fi

echo "[entrypoint] Applying database migrations"
npx prisma migrate deploy

if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
  USERS=$(npx tsx scripts/db.ts count-users 2>/dev/null | tail -n 1 || echo 0)
  if [ "$USERS" = "0" ]; then
    echo "[entrypoint] Empty database and SEED_DEMO_DATA=true: loading demo data"
    npx tsx prisma/seed.ts
  else
    echo "[entrypoint] Database already has $USERS users: demo data not loaded"
  fi
fi

exec "$@"
