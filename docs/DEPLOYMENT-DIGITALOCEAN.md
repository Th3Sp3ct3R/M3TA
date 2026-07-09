# CI/CD + DigitalOcean Deployment Plan

Goal: the Ares **Garrison daemon** (plus the Telegram channel bridge) running 24/7 on a
DigitalOcean Droplet, redeployed automatically on every green push to `main`, with
persistent agent state, private-network-only access, monitoring, and one-command rollback.

Ares is not a web app. "Live" means the always-on daemon is reachable by *you* — via
`ares attach` over a private network and via the Telegram bot from your phone. Nothing
in this plan exposes the gateway to the public internet, on purpose: the daemon can run
shell commands and drive a browser, and the codebase itself declares loopback binding
"the real wall."

---

## 0. Current state (what already exists)

| Piece | Status |
|---|---|
| CI (`.github/workflows/ci.yml`) | ✅ Build + `node --test` on Ubuntu **and** Windows, Rust build for Tauri, on push/PR to `main` |
| Upstream sync (`sync-upstream.yml`) | ✅ Pulls `clout2buy/Ares` → PR into this fork every 6 h |
| Release / AppImage workflows | ✅ Desktop installers (not relevant to server deploy) |
| CD to a server | ❌ None — this plan adds it |
| Dockerfile / compose | ❌ None — Phase 1 adds them |
| Health endpoint | ✅ Garrison gateway serves `GET /health` (same port as the WS gateway, default 7421) |

Deployment-relevant constraints discovered in the code:

- Garrison binds `127.0.0.1` unless `ARES_GARRISON_HOST` overrides; port from
  `ARES_GARRISON_PORT` (default `7421`). Auth is a 32-hex token at `~/.ares/garrison/token`.
- All durable state (encrypted provider keys, mind/memory, sessions, garrison token)
  lives under `~/.ares` (`ARES_HOME` overrides). **This must be a persistent volume.**
- `better-sqlite3` is a native module → the runtime image must compile it (or reuse
  prebuilt binaries) for linux-x64.
- License is AGPL-3.0-only: if a *modified* Ares is offered as a network service to
  others, users must be offered the source. A single-owner private daemon is fine.

## 1. Target architecture

```
GitHub (Th3Sp3ct3R/M3TA)
  │  push to main
  ▼
GitHub Actions
  ├─ ci.yml            build + test (exists, unchanged)
  └─ deploy.yml (new)  needs: ci → build linux image → push to DOCR
                        → SSH to droplet → docker compose pull && up -d
                        → poll /health → success/rollback
  │
  ▼
DigitalOcean
  ├─ Container Registry (DOCR)   ares:sha-<commit>, ares:latest
  └─ Droplet (Ubuntu 24.04, 2 vCPU / 4 GB)
       ├─ docker compose: service "garrison"
       │    image: registry.digitalocean.com/<reg>/ares:latest
       │    command: ares garrison serve
       │    ports: 127.0.0.1:7421 → container 7421   (loopback only)
       │    volume: /srv/ares/home → /root/.ares      (persistent state)
       │    healthcheck: GET /health
       ├─ (same container or 2nd service): ares telegram — outbound long-poll,
       │    no inbound port needed
       ├─ Tailscale (host-level) — the ONLY remote path to the gateway
       └─ ufw: deny all inbound except SSH (or SSH via Tailscale only)

Access paths:
  • Laptop:  tailscale → ssh -L 7421:127.0.0.1:7421 → ares attach
  • Phone:   Telegram bot (bridge polls Telegram; zero inbound exposure)
```

**Why a Droplet and not App Platform:** App Platform's filesystem is ephemeral — `~/.ares`
(keys, memory, sessions) would be wiped on every deploy, and there's no way to keep the
gateway off the public internet. A Droplet gives a persistent volume, loopback binding,
and Tailscale. Kubernetes (DOKS) is overkill for one daemon.

## 2. Phase 1 — Containerize (repo changes)

**1. `Dockerfile`** (multi-stage, repo root):

```dockerfile
# ---- build ----
FROM node:22-bookworm AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
RUN pnpm build

# ---- runtime ----
FROM node:22-bookworm-slim
RUN corepack enable
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages ./packages
# prod deps only; better-sqlite3 ships prebuilds for linux-x64 so no toolchain needed.
# If a native rebuild is ever forced, add: apt-get install -y python3 make g++
RUN pnpm install --frozen-lockfile --prod
ENV ARES_HOME=/data/.ares \
    ARES_GARRISON_HOST=0.0.0.0 \
    ARES_GARRISON_PORT=7421
VOLUME /data
EXPOSE 7421
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7421/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/cli/dist/entry.js", "garrison", "serve"]
```

Note `ARES_GARRISON_HOST=0.0.0.0` is **inside the container**; the compose port mapping
pins it to the droplet's loopback, so nothing is publicly reachable.

**2. `.dockerignore`**: `node_modules`, `tauri`, `.git`, `**/dist` excluded from the
build context *except* we build inside the image, so just `node_modules`, `.git`,
`tauri/src-tauri/target`, `.ares`, `docs`.

**3. `docker-compose.yml`** (lives on the droplet at `/srv/ares/`, checked into the repo
under `deploy/` as the source of truth):

```yaml
services:
  garrison:
    image: registry.digitalocean.com/<your-registry>/ares:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:7421:7421"      # loopback only — Tailscale/SSH is the way in
    volumes:
      - /srv/ares/home:/data
    logging:
      driver: json-file
      options: { max-size: "20m", max-file: "5" }

  telegram:
    image: registry.digitalocean.com/<your-registry>/ares:latest
    command: ["node", "packages/cli/dist/entry.js", "telegram", "start"]
    restart: unless-stopped
    depends_on:
      garrison: { condition: service_healthy }
    volumes:
      - /srv/ares/home:/data        # shares the same ~/.ares (token, keys)
```

(Verify the exact `ares telegram` subcommand before wiring the second service; run it
manually in the container first.)

**4. Local verification gate** before any DO work:
`docker build -t ares-local . && docker run --rm -p 127.0.0.1:7421:7421 -v /tmp/ares-home:/data ares-local`
then `curl http://127.0.0.1:7421/health` from the host.

## 3. Phase 2 — Provision DigitalOcean (one-time, ~30 min)

1. **Container Registry**: create DOCR (Basic tier, $5/mo, holds ~5 tagged images).
2. **Droplet**: Ubuntu 24.04 LTS, **2 vCPU / 4 GB** ($24/mo; the agent spawns node
   workers and a browser — 1 GB will OOM). Region nearest you. SSH key auth only.
3. **First-boot hardening** (script it as `deploy/provision.sh`):
   - non-root `deploy` user with docker group; disable password SSH + root login
   - `ufw default deny incoming; ufw allow OpenSSH; ufw enable`
   - unattended-upgrades on
   - 2 GB swapfile (native-module builds and browser sessions spike)
   - install Docker Engine + compose plugin
   - install **Tailscale**, `tailscale up`, note the tailnet IP
   - `mkdir -p /srv/ares/home` (the persistent `~/.ares`)
   - `doctl registry login` (or `docker login` with a DOCR read token) so compose can pull
4. **Optional stricter posture**: once Tailscale is confirmed working, move SSH behind it
   (`ufw delete allow OpenSSH`, allow 22 on `tailscale0` only). Zero public inbound ports.
5. **Backups**: enable DO weekly Droplet snapshots (+20% of droplet cost) **and** a nightly
   cron that tars `/srv/ares/home` to DO Spaces via `rclone` — the agent's mind is the
   one thing you can't rebuild from git.

## 4. Phase 3 — CI (keep) + image build

`ci.yml` stays as-is — it's already good (matrix build+test, concurrency cancel).
Add `.github/workflows/deploy.yml`:

```yaml
name: Deploy (DigitalOcean)

on:
  push:
    branches: [main]
  workflow_dispatch:        # manual redeploy / rollback entry point
    inputs:
      image_tag:
        description: "Existing image tag to roll back to (skip build)"
        required: false

concurrency:
  group: deploy-production
  cancel-in-progress: false   # never kill a deploy mid-flight

permissions:
  contents: read

jobs:
  test:
    # Re-run the linux leg as the deploy gate (or convert ci.yml to
    # workflow_call and `uses:` it here to avoid duplication).
    if: ${{ !inputs.image_tag }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test

  build-push:
    if: ${{ !inputs.image_tag }}
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Login to DOCR
        uses: docker/login-action@v3
        with:
          registry: registry.digitalocean.com
          username: ${{ secrets.DO_REGISTRY_TOKEN }}
          password: ${{ secrets.DO_REGISTRY_TOKEN }}
      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            registry.digitalocean.com/${{ vars.DO_REGISTRY }}/ares:sha-${{ github.sha }}
            registry.digitalocean.com/${{ vars.DO_REGISTRY }}/ares:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: [build-push]
    if: ${{ always() && (needs.build-push.result == 'success' || inputs.image_tag) }}
    runs-on: ubuntu-latest
    environment: production       # add a required reviewer here for a manual gate
    steps:
      - name: Deploy over SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DROPLET_HOST }}
          username: deploy
          key: ${{ secrets.DROPLET_SSH_KEY }}
          script: |
            set -euo pipefail
            cd /srv/ares
            TAG="${{ inputs.image_tag || format('sha-{0}', github.sha) }}"
            sed -i "s|/ares:.*$|/ares:${TAG}|" docker-compose.yml
            docker compose pull
            docker compose up -d
            # health gate: fail the workflow if the daemon doesn't come up
            for i in $(seq 1 20); do
              sleep 3
              curl -fsS http://127.0.0.1:7421/health && exit 0
            done
            echo "healthcheck failed"; docker compose logs --tail 100 garrison; exit 1
```

Design choices:

- **Immutable tags** (`sha-<commit>`) are what actually get deployed; `latest` is a
  convenience pointer. Rollback = `workflow_dispatch` with a previous `sha-…` tag —
  no rebuild, ~1 minute.
- **`environment: production`** gives you a place to attach a required-reviewer
  approval later without touching the workflow.
- The deploy SSHes as the unprivileged `deploy` user; the SSH key in GitHub secrets is
  a *dedicated* deploy key, not your personal one. If you moved SSH behind Tailscale in
  Phase 2, either keep 22 open to GitHub's runners with fail2ban, or run a self-hosted
  runner on the droplet / use Tailscale's GitHub Action to join the tailnet — pick one
  when you get there (simplest: keep public SSH key-only + fail2ban).

## 5. Phase 4 — Secrets & configuration

| Secret | Where | Notes |
|---|---|---|
| `DO_REGISTRY_TOKEN` | GitHub repo secrets | DOCR API token (read/write) |
| `DROPLET_HOST` | GitHub repo secrets | Droplet public IP (or tailnet IP w/ TS action) |
| `DROPLET_SSH_KEY` | GitHub repo secrets | Dedicated ed25519 deploy key |
| `DO_REGISTRY` | GitHub repo *variables* | Registry name (not secret) |
| Provider API keys (OpenRouter, Anthropic…) | **Never in GitHub.** | Live AES-encrypted in `/srv/ares/home` on the droplet |
| Telegram bot token | Same | Set once via Ares' conversational setup |

One-time seeding of provider keys, after the first deploy:
`docker compose exec garrison node packages/cli/dist/entry.js doctor` then run the
interactive setup (`chat` → "connect telegram", etc.) once inside the container —
everything persists in the volume across deploys.

## 6. Phase 5 — Observability & operations

- **Uptime**: point Uptime-Kuma (already in your stack) at the droplet's *tailnet*
  IP `http://<tailscale-ip>:7421/health` — requires binding the compose port to the
  tailscale interface too (`<tailscale-ip>:7421:7421` as a second mapping), or run the
  Kuma probe on the droplet itself. Alert → Telegram.
- **DO Monitoring**: free agent; alert policies on CPU > 80% (10 min) and disk > 85%.
- **Logs**: `docker compose logs -f garrison` for now; json-file rotation is configured
  in compose. Graduate to Vector → DO Spaces or Grafana Cloud only if you need history.
- **Runbook one-liners** (document in the repo, they're the whole ops surface):
  - status: `docker compose ps && curl -s localhost:7421/health`
  - restart: `docker compose restart garrison`
  - rollback: GitHub → Actions → Deploy → Run workflow → `image_tag: sha-<old>`
  - kill switch: the effects layer's kill switch, plus `docker compose down` as the hammer
- **State backup verification**: monthly, restore the `/srv/ares/home` tarball into a
  scratch container and run `ares agent doctor` against it.

## 7. Phase 6 — Security posture (recap + Ares-specific)

1. Gateway is **never** on a public interface: container may bind 0.0.0.0, but the host
   port mapping is `127.0.0.1` (+ optionally the tailscale IP). Verify from outside:
   `nmap -p 7421 <public-ip>` must show closed/filtered.
2. Garrison token auth stays on (it's automatic); Tailscale ACLs restrict which of your
   devices can reach port 7421 at all.
3. Unattended-mode guardrails are already in the code (no autonomous money movement,
   credential leaks, mail sending, destructive shell) — do **not** enable bypass mode on
   the server.
4. The deploy key can only log in as `deploy`; that user owns `/srv/ares` and is in the
   `docker` group, nothing else.
5. AGPL: private single-user daemon = no obligation; if you ever open the Telegram bot
   or gateway to other users on a modified fork, publish the fork's source.

## 8. Execution checklist (ordered)

- [ ] Commit current dirty working tree (`holotable.ts`, `package.json`, `AGENTS.md`, …)
- [ ] Phase 1: add `Dockerfile`, `.dockerignore`, `deploy/docker-compose.yml`, `deploy/provision.sh`; verify image locally (build → run → `/health`)
- [ ] Phase 2: create DOCR + Droplet, run `provision.sh`, join Tailscale, confirm `nmap` shows no public 7421
- [ ] Push a manually built image, `docker compose up -d` by hand once — prove the runtime before automating it
- [ ] Seed provider keys + Telegram token inside the container (persist to volume)
- [ ] Phase 3: add `deploy.yml` + GitHub secrets; push a trivial commit to `main`; watch the full pipeline go green
- [ ] Test rollback: `workflow_dispatch` with the previous sha tag
- [ ] Phase 5: Uptime-Kuma monitor + DO alert policies + nightly state backup cron
- [ ] Kill-switch drill: confirm you can stop the daemon from your phone (Telegram) and laptop

## 9. Cost

| Item | $/mo |
|---|---|
| Droplet 2 vCPU / 4 GB | 24 |
| Weekly snapshots (+20%) | ~5 |
| DOCR Basic | 5 |
| Spaces (backups, optional) | 5 |
| Tailscale (personal) | 0 |
| **Total** | **~$34–39/mo** |

Downgrade path: a 1 vCPU / 2 GB droplet ($12) works if you keep browser use light; watch
memory for the first week before deciding.
