# ---- Payment Sandbox production image ----
FROM node:20-alpine

# Small init so signals (SIGTERM) reach Node for graceful shutdown.
RUN apk add --no-cache tini

ENV NODE_ENV=production
WORKDIR /app

# Install only production dependencies first (better layer caching).
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# App source.
COPY . .

# Run as the built-in non-root user.
USER node

EXPOSE 3000

# Container-level health check hits the plain liveness endpoint.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
