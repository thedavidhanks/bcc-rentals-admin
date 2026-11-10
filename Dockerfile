# syntax=docker/dockerfile:1
# Multi-stage build for the BCC Rentals ADMIN app: Next.js standalone on GCP
# Cloud Run, port 8080. See docs/DEPLOY_CLOUD_RUN.md.

# --- deps: install production + build dependencies -----------------------------
FROM node:22-alpine AS deps
WORKDIR /app
# This repo is an npm WORKSPACES monorepo (package.json -> "workspaces":
# ["packages/*"]) and package-lock.json carries an entry for packages/scheduler,
# so copy every workspace manifest before installing. (Measured on npm 10.9 and
# 11.19, `npm ci` happens to tolerate the missing manifest and still creates the
# node_modules/@bcc/scheduler symlink from the lockfile — but that is incidental,
# undocumented behaviour, and it silently skips any dependency declared only in a
# workspace manifest. Copy them.)
# One COPY per workspace keeps this layer cached on manifest changes only: the
# glob `packages/*/package.json` would flatten the directory structure, and
# `COPY packages ./packages` would bust the cache on every source edit.
# NOTE: add a line here when a new workspace is added under packages/.
COPY package.json package-lock.json* ./
COPY packages/scheduler/package.json ./packages/scheduler/package.json
RUN npm ci

# --- builder: compile the standalone Next.js output ---------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* values are inlined into the browser bundle at BUILD time, so they
# must arrive as --build-arg (see .github/workflows/ci.yml and
# docs/DEPLOY_CLOUD_RUN.md). They are publishable client config, not secrets, but
# they still differ per environment (bcc-admin-staging vs bcc-admin-prod), so
# never bake literals in here. The same values must ALSO be set as runtime env
# vars on the Cloud Run service: lib/public-env.ts re-validates them with Zod on
# the server at module load.
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID \
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID

# Server-side vars that lib/env.ts Zod-validates at module load. `next build`
# imports those modules, so the build FAILS without them — but the build never
# opens a connection, so DATABASE_URL here is a throwaway placeholder. The real
# value is injected at RUNTIME from Secret Manager (--set-secrets); do not pass
# the production connection string as a build arg.
ARG FIREBASE_PROJECT_ID
ARG DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID \
    DATABASE_URL=$DATABASE_URL

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
