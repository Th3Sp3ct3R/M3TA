# Ares Garrison — Ops Runbook

Host: `ares-garrison` droplet (DigitalOcean, sfo3) · services via docker compose in `/srv/ares/`.
Access: SSH as `deploy` (key-only). Gateway is loopback-bound on the host — reach it via
SSH tunnel (`ssh -L 7421:127.0.0.1:7421 deploy@<host>`) or Tailscale.

## Status
```bash
ssh deploy@<host> 'docker compose -f /srv/ares/docker-compose.yml ps && curl -s http://127.0.0.1:7421/health'
```

## Logs
```bash
ssh deploy@<host> 'docker compose -f /srv/ares/docker-compose.yml logs --tail 100 garrison'
ssh deploy@<host> 'docker compose -f /srv/ares/docker-compose.yml logs --tail 100 telegram'
```

## Restart
```bash
ssh deploy@<host> 'cd /srv/ares && docker compose restart garrison'
```

## Deploy / Rollback
- Deploy: push to `main` (CI + deploy workflow does the rest).
- Rollback: GitHub → Actions → "Deploy (DigitalOcean)" → Run workflow → set
  `image_tag` to a previous `sha-<commit>` tag. ~1 minute, no rebuild.
- List available tags: `doctl registry repository list-tags ares`

## Kill switch (in escalation order)
1. Ares' own kill switch (halts all outward effects, daemon keeps running).
2. `ssh deploy@<host> 'cd /srv/ares && docker compose stop'` — stops the daemon + bridge.
3. `doctl compute droplet-action power-off <droplet-id>` — the hammer.

## State backup
- All durable state lives in `/srv/ares/home` (the container's `/data`).
- Nightly: `tar czf - -C /srv/ares home | <push to Spaces/rclone>` (cron on the host).
- Restore drill: untar into a scratch dir, mount into a scratch container,
  run `node packages/cli/dist/entry.js agent doctor`.

## Secrets
- Provider keys + Telegram token live AES-encrypted inside `/srv/ares/home` — never in
  GitHub, never in the image. Seed once via the conversational setup or the daemon's
  NDJSON `openrouter_key` / `provider_key` commands (see ENG-136 for the env-var gotcha).
