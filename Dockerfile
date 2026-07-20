# syntax=docker/dockerfile:1
# Multi-stage build for a Next.js standalone app on GCP Cloud Run (port 8080).
# No PayPal/storefront-specific content — this is the admin app.

# --- deps: install production + build dependencies -----------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# --- builder: compile the standalone Next.js output ---------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* values are inlined at build time — pass them as build args on
# Cloud Run (see spec §10/§11) so the Firebase Web SDK config is baked in.
RUN npm run build

# --- runner: minimal image serving the standalone server ----------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Cloud Run sends traffic to $PORT (8080). Next's standalone server reads PORT/HOSTNAME.
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# .next/standalone already contains a minimal node_modules + server.js.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
