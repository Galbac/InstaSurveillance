FROM node:24-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --cache /tmp/npm-cache
FROM base AS dev
COPY . .
CMD ["npm", "run", "dev"]
FROM base AS builder
COPY . .
RUN npm run build
FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache 'zlib>=1.3.2-r1'
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
CMD ["node", "server.js"]
