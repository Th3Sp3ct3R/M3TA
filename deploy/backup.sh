#!/usr/bin/env bash
# Nightly ~/.ares state backup with 7-day retention. Streams the tar from
# INSIDE the garrison container (state dir is root-owned 700 on the host).
# Offsite = weekly DO droplet snapshots; upgrade path: rclone to Spaces.
set -euo pipefail
STAMP=$(date +%Y%m%d-%H%M)
docker compose -f /srv/ares/docker-compose.yml exec -T garrison tar czf - -C / data \
  > "/srv/ares/backups/ares-home-${STAMP}.tgz"
ls -t /srv/ares/backups/ares-home-*.tgz | tail -n +8 | xargs -r rm --
