# ═══════════════════════════════════════════════════════════════
# COMPASS — production image (multi-stage, ~25 MB served)
#
# The app is a static SPA; the only build-time inputs that matter
# are the two VITE_ variables (Vite bakes them into the bundle, so
# they are ARGs here, not ENVs — this is normal for client-side
# Supabase apps; the anon key is public by design and RLS protects
# the data).
#
# Build & run:
#   docker compose up --build        # http://localhost:8080
# ═══════════════════════════════════════════════════════════════

# ── Stage 1: build the bundle ─────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Copy manifests first so npm ci is cached between code changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Supabase coordinates come from build args (see compose / k8s).
ARG VITE_SUPABASE_URL=http://localhost:54321
ARG VITE_SUPABASE_ANON_KEY=placeholder-anon-key
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build

# ── Stage 2: serve ─────────────────────────────────────────────
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
