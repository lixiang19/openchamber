# syntax=docker/dockerfile:1
FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/ui/package.json ./packages/ui/
COPY packages/web/package.json ./packages/web/
COPY packages/desktop/package.json ./packages/desktop/
COPY packages/vscode/package.json ./packages/vscode/
RUN bun install --frozen-lockfile --ignore-scripts

FROM deps AS builder
WORKDIR /app
COPY . .
RUN bun run build:web

FROM oven/bun:1 AS runtime
WORKDIR /home/openaurora

RUN apt-get update && apt-get install -y --no-install-recommends \
  bash \
  ca-certificates \
  git \
  less \
  nodejs \
  npm \
  openssh-client \
  python3 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=cloudflare/cloudflared:latest /usr/local/bin/cloudflared /usr/local/bin/cloudflared

ENV NODE_ENV=production

# Create openaurora user
RUN useradd -m -s /bin/bash openaurora && mkdir -p /home/openaurora && chown -R openaurora:openaurora /home/openaurora

# Switch to openaurora user
USER openaurora

ENV NPM_CONFIG_PREFIX=/home/openaurora/.npm-global
ENV PATH=${NPM_CONFIG_PREFIX}/bin:${PATH}

RUN npm config set prefix /home/openaurora/.npm-global && mkdir -p /home/openaurora/.npm-global && \
  mkdir -p /home/openaurora/.local /home/openaurora/.config /home/openaurora/.ssh && \
  npm install -g opencode-ai

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/web/node_modules ./packages/web/node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/web/package.json ./packages/web/package.json
COPY --from=builder /app/packages/web/bin ./packages/web/bin
COPY --from=builder /app/packages/web/server ./packages/web/server
COPY --from=builder /app/packages/web/dist ./packages/web/dist
COPY scripts/docker-entrypoint.sh /home/openaurora/openaurora-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["sh", "/home/openaurora/openaurora-entrypoint.sh"]
