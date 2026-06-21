# FS25 Dashboard relay image.
# Build context = src/Dashboard (so we can COPY both Relay/ and Server/public).
#   docker compose build   (compose sets context: .. for us)
FROM node:22-slim

WORKDIR /app

# Dependencies first for layer caching.
COPY Relay/package.json Relay/package-lock.json* ./
RUN npm ci --omit=dev

# Relay app + the read-only frontend (served from /app/public).
COPY Relay/index.js Relay/logger.js ./
COPY Server/public ./public

# Run as the built-in non-root user.
USER node

ENV RELAY_PORT=8080 \
    PUBLIC_DIR=/app/public \
    PUBLISHERS_FILE=/config/publishers.json \
    LOG_LEVEL=info

EXPOSE 8080
CMD ["node", "index.js"]
