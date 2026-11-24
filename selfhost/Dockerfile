FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run selfhost:build

FROM node:24-bookworm-slim AS runtime
ARG CODEX_VERSION=0.166.0
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates fonts-noto-cjk fontconfig \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global @openai/codex@${CODEX_VERSION} --no-audit --no-fund
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && mkdir -p /app/data /app/backups /home/node/.codex \
    && chown -R node:node /app/data /app/backups /home/node/.codex
COPY --from=build /app/selfhost-dist ./selfhost-dist
COPY --from=build /app/selfhost ./selfhost
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5180 DATA_DIR=/app/data
USER node
EXPOSE 5180
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:5180/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "selfhost/server.mjs"]
