# ============================================================
# AI Reviewer — Dockerfile
# Multi-stage build untuk image yang lean
# ============================================================

# Stage 1: Build
FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

# Copy dependency files dulu (leverage layer cache)
COPY package.json bun.lock ./

# Install deps (production only for final image)
RUN bun install --frozen-lockfile

# Copy source code
COPY src/ ./src/
COPY skills/ ./skills/
COPY tsconfig.json ./

# ============================================================
# Stage 2: Runtime (lean image)
# ============================================================
FROM oven/bun:1.3-alpine AS runner

WORKDIR /app

# Non-root user untuk keamanan
RUN addgroup -S gatot && adduser -S gatot -G gatot

# Copy dari builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/skills ./skills
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

USER gatot

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

# Start Gatot
CMD ["bun", "run", "src/index.ts"]
