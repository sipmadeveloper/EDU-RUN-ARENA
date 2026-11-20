FROM node:22-bookworm-slim

# Native build tools fallback for better-sqlite3 on Linux
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

# Hugging Face Spaces runs containers as non-root UID 1000
RUN useradd -m -u 1000 user

WORKDIR /app

# Copy dependency manifests first for fast Docker layer caching
COPY --chown=user:user package.json package-lock.json* ./

RUN npm install --no-audit --no-fund

# Copy full application source
COPY --chown=user:user . .

# Build Vite production bundle into /app/dist
RUN npm run build

# Ensure writable SQLite data directory for non-root user
RUN mkdir -p /app/data && chown -R user:user /app

USER user

ENV NODE_ENV=production
ENV PORT=7860
ENV HOME=/home/user

EXPOSE 7860

CMD ["npx", "tsx", "server.ts"]
