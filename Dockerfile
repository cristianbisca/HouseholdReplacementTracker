FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

# --- Runtime stage ---
FROM node:18-alpine

WORKDIR /app

# Install openssl for self-signed certificate generation
RUN apk add --no-cache openssl

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

# Copy application source
COPY server/ ./server/
COPY public/ ./public/

# Create data and certs directories and set permissions
RUN mkdir -p /app/data /app/certs && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const http=require('http'); const https=require('https'); const fs=require('fs'); const tlsMode=(process.env.TLS_MODE||'auto').toLowerCase(); const certsExist=fs.existsSync('/app/certs/cert.pem') && fs.existsSync('/app/certs/key.pem'); const useHttps=tlsMode!=='off' && certsExist; const client=useHttps?https:http; client.get({hostname:'localhost',port:3000,path:'/api/health',rejectUnauthorized:false}, (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

CMD ["node", "server/index.js"]