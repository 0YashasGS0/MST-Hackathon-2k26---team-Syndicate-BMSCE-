# Backend image. Build from the REPO ROOT (it needs shared/):  docker build -f backend/Dockerfile -t kx-backend .
# ---- build: install shared (with its build tools, so its `prepare` works) and the backend's production deps
FROM node:22-bookworm-slim AS build
# Compilers are only a fallback for better-sqlite3 when its prebuilt binary can't be downloaded (=0 to skip).
ARG NATIVE_BUILD_TOOLS=1
RUN if [ "$NATIVE_BUILD_TOOLS" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*; \
    fi
WORKDIR /app
COPY shared/package.json shared/package-lock.json shared/
RUN cd shared && npm ci --no-audit --no-fund --ignore-scripts
COPY shared/ shared/
COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci --omit=dev --no-audit --no-fund
COPY backend/ backend/
# Drop shared's dev tooling now that everything is installed (dist/ is committed).
RUN cd shared && npm prune --omit=dev --no-audit --no-fund

# ---- runtime: no compilers, non-root, data on a volume
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=5000
WORKDIR /app
COPY --from=build --chown=node:node /app/shared /app/shared
COPY --from=build --chown=node:node /app/backend /app/backend
WORKDIR /app/backend
RUN mkdir -p data/uploads && chown -R node:node data
USER node
VOLUME ["/app/backend/data"]
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/drafts').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/index.ts"]
