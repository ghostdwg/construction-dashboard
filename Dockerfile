# Stage 1: Install dependencies
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci

# Stage 2: Build the application
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Phase R5: APP_ENV is required at build time so lib/env.ts Zod parse
# succeeds during `next build`. The "local" value here is a build-only
# placeholder — at container runtime the tier env_file (/opt/neuroglitch/.env
# or .env.staging) sets the real APP_ENV, which is what lib/env.ts validates
# at server boot and what proxy.ts reads when injecting X-App-Env.
#
# Phase R6.7: do NOT declare X-App-Env in next.config.ts `headers()` — that
# function is evaluated at build time and would bake "local" into every
# response in every tier. The X-App-Env injection lives in proxy.ts (Node
# runtime middleware) so it reads the runtime APP_ENV per request.
ENV APP_ENV="local"
# Phase R6.5: DATABASE_URL during the build stage must be a file: URL so
# prisma.config.ts permits the build (it refuses libsql:// to prevent the
# P1013 silent-failure mode). The real Turso DATABASE_URL is injected at
# container runtime via the tier env_file, which overrides this default.
ENV DATABASE_URL="file:./build.db"
ENV DATABASE_AUTH_TOKEN=""
ENV AUTH_SECRET="placeholder-auth-secret-minimum-32-chars-xx"
ENV ANTHROPIC_API_KEY="sk-ant-placeholder"
ENV NEXTAUTH_URL="https://neuroglitch.ai"

RUN npm run build

# Stage 3: Production runtime
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl curl
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@napi-rs ./node_modules/@napi-rs
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/@libsql ./node_modules/@libsql
COPY --from=builder /app/node_modules/@prisma/adapter-libsql ./node_modules/@prisma/adapter-libsql
# pdfjs-dist is a serverExternalPackages entry (next.config.ts), so Next's
# standalone trace never bundles it, and it sets GlobalWorkerOptions.workerSrc
# from a plain string ("./pdf.worker.mjs" in pdf.mjs) rather than a
# statically-traceable import — the trace copies pdf.mjs itself but not the
# worker file it loads at runtime. Copy the whole package explicitly, same
# pattern as the other trace-gap packages above.
COPY --from=builder /app/node_modules/pdfjs-dist ./node_modules/pdfjs-dist
COPY --from=builder /app/prisma ./prisma

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
