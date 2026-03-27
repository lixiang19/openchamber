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
WORKDIR /home/ridge

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

# Create ridge user
RUN useradd -m -s /bin/bash ridge && mkdir -p /home/ridge && chown -R ridge:ridge /home/ridge

# Switch to ridge user
USER ridge

ENV NPM_CONFIG_PREFIX=/home/ridge/.npm-global
ENV PATH=${NPM_CONFIG_PREFIX}/bin:${PATH}

RUN npm config set prefix /home/ridge/.npm-global && mkdir -p /home/ridge/.npm-global && \
  mkdir -p /home/ridge/.local /home/ridge/.config /home/ridge/.ssh && \
  npm install -g opencode-ai

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/web/node_modules ./packages/web/node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/web/package.json ./packages/web/package.json
COPY --from=builder /app/packages/web/bin ./packages/web/bin
COPY --from=builder /app/packages/web/server ./packages/web/server
COPY --from=builder /app/packages/web/dist ./packages/web/dist
COPY scripts/docker-entrypoint.sh /home/ridge/ridge-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["sh", "/home/ridge/ridge-entrypoint.sh"]
