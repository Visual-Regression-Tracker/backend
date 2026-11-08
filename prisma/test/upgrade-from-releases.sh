#!/bin/sh
# Needs the release tags fetched, psql, and DATABASE_URL pointing at a database to connect through.
set -eu

cd "$(dirname "$0")/.."
PSQL=${PSQL:-psql}
SERVER_URL=${DATABASE_URL%/*}
OFF='{"blur":{"enabled":false,"amplitudeThreshold":80,"solidShareMax":0.01},"dinov2":{"enabled":false,"distanceThreshold":0.15}}'
RC4_ON='{"blur":{"enabled":true,"amplitudeThreshold":80,"solidShareMax":0.01},"dinov2":{"enabled":true,"distanceThreshold":0.15}}'
CUSTOM='{"blur":{"enabled":true,"amplitudeThreshold":70,"solidShareMax":0.02},"dinov2":{"enabled":false,"distanceThreshold":0.2}}'
WORK=.upgrade-test
trap 'rm -rf "$WORK"' EXIT

expect() {
  actual=$($PSQL "$1" -qAtc "SELECT \"noiseAnalysisConfig\" FROM \"Project\" WHERE id = '$2'")
  [ "$actual" = "$3" ] || { echo "$4: project $2 has $actual, expected $3"; exit 1; }
}

upgrade() {
  tag=$1 db=vrt_upgrade_$2 url=$SERVER_URL/vrt_upgrade_$2
  echo "== $tag"
  $PSQL "$DATABASE_URL" -qc "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db"
  rm -rf "$WORK" && mkdir "$WORK"
  git -C .. archive "$tag" prisma/migrations | tar -x --strip-components=1 -C "$WORK"
  [ -f "$WORK/migrations/migration_lock.toml" ] || { echo "$tag: no migrations extracted"; exit 1; }
  cp schema.prisma prisma.config.ts "$WORK"
  DATABASE_URL=$url npx prisma migrate deploy --config "$WORK/prisma.config.ts"
  $PSQL "$url" -qc "INSERT INTO \"Project\" (id, name, \"updatedAt\") VALUES ('default', 'default', now())"
  if [ "$2" != v5 ] && [ "$2" != rc1 ]; then
    $PSQL "$url" -qc "INSERT INTO \"Project\" (id, name, \"updatedAt\", \"noiseAnalysisConfig\") VALUES ('custom', 'custom', now(), '$CUSTOM')"
  fi
  DATABASE_URL=$url npx prisma migrate deploy
  DATABASE_URL=$url npx prisma migrate diff --from-config-datasource --to-schema schema.prisma --exit-code
}

upgrade api-v5.7.0 v5
expect "$SERVER_URL/vrt_upgrade_v5" default "$OFF" "5.x project"

upgrade api-v6.0.0-rc1 rc1
expect "$SERVER_URL/vrt_upgrade_rc1" default "$OFF" "rc1 project"

upgrade api-v6.0.0-rc4 rc4
expect "$SERVER_URL/vrt_upgrade_rc4" default "$RC4_ON" "rc4 project"
expect "$SERVER_URL/vrt_upgrade_rc4" custom "$CUSTOM" "rc4 project"

upgrade api-v6.0.0-rc7 rc7
expect "$SERVER_URL/vrt_upgrade_rc7" default "$OFF" "rc7 project"
expect "$SERVER_URL/vrt_upgrade_rc7" custom "$CUSTOM" "rc7 project"

$PSQL "$SERVER_URL/vrt_upgrade_rc4" -qAtc "SELECT \"column_default\" FROM information_schema.columns WHERE table_name = 'Project' AND column_name = 'noiseAnalysisConfig'" |
  grep -qF "$OFF" || { echo "rc4 noiseAnalysisConfig default is not OFF"; exit 1; }
echo "All upgrades passed"
