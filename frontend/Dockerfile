# Frontend image (Next.js standalone). Build from frontend/:  docker build -t kx-frontend frontend
# NEXT_PUBLIC_* values are baked into the browser bundle (and the CSP) at BUILD time — pass them as build args.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_API_KEY
ARG NEXT_PUBLIC_MST_RPC_URL=https://testnetrpc.mstblockchain.com
ARG NEXT_PUBLIC_MST_WS_URL=wss://testnetrpc.mstblockchain.com
ARG NEXT_PUBLIC_EXPLORER=https://testnet.mstscan.com
ARG NEXT_PUBLIC_ESCROW_ADDRESS
ARG NEXT_PUBLIC_USD_ADDRESS
ARG NEXT_PUBLIC_LIVE_ENDPOINTS
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
