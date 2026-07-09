# Ares Garrison daemon — linux-x64 runtime image.
#
# Build:  docker build -t ares .
# Run:    docker run -d -p 127.0.0.1:7421:7421 -v ares-home:/data ares
#
# The container binds 0.0.0.0 INSIDE its own namespace; the host port mapping
# is what pins exposure to loopback/tailnet. All durable state (encrypted
# provider keys, mind, sessions, garrison token) lives under /data — mount it.

# ---- build: compile the TypeScript workspace ----
FROM node:22-bookworm AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm build

# ---- runtime: prod deps + built dist only ----
# Playwright's Debian 12 (bookworm) base ships Chromium + every system lib the
# browser connector needs (ENG-129: strategy order lands on bundled Chromium
# headless in a container). It includes Node 22, so no second Node install.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy AS runtime
RUN corepack enable
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages ./packages
# Prune to production dependencies (keeps better-sqlite3 prebuilds, drops toolchain).
RUN pnpm install --frozen-lockfile --prod

ENV ARES_HOME=/data/.ares \
    ARES_GARRISON_HOST=0.0.0.0 \
    ARES_GARRISON_PORT=7421 \
    NODE_ENV=production
VOLUME /data
EXPOSE 7421

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7421/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/cli/dist/entry.js", "garrison", "serve"]
