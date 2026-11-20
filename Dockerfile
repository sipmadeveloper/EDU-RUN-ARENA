FROM node:22-bookworm-slim

# Native build tools fallback for better-sqlite3 on Linux
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

# Official node:22 images already include non-root user "node" with UID 1000 (matches Hugging Face Spaces UID 1000)
WORKDIR /app

# Copy dependency manifests first for fast Docker layer caching
COPY --chown=node:node package.json package-lock.json* ./

RUN npm install --no-audit --no-fund

# Copy full application source
COPY --chown=node:node . .

# Build Vite production bundle into /app/dist
RUN npm run build

# Ensure writable SQLite data directory & app files for UID 1000 (node)
RUN mkdir -p /app/data && chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV PORT=7860
ENV HOME=/home/node

EXPOSE 7860

CMD ["npx", "tsx", "server.ts"]
