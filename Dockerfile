FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY scripts/patch-nexconn-chatui.js scripts/nexconn-calendar-date.js ./scripts/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_PATH=/data/nexconn-chat.sqlite
COPY package.json package-lock.json .npmrc ./
COPY scripts ./scripts
RUN npm ci --omit=dev \
  && mkdir -p /data \
  && chown -R node:node /app /data
COPY server ./server
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/index.js"]
