FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

# --- Runtime stage ---
FROM node:18-alpine

WORKDIR /app

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

# Copy application source
COPY server/ ./server/
COPY public/ ./public/

# Create data directory and set permissions
RUN mkdir -p /app/data && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

CMD ["node", "server/index.js"]