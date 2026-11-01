FROM node:26-bookworm-slim AS builder
WORKDIR /app

COPY prisma.config.ts ./
COPY ./prisma/schema.prisma ./prisma/

COPY package*.json ./

RUN npm ci

COPY tsconfig*.json nest-cli.json .swcrc ./
COPY src ./src

RUN npm run typecheck && npm run build && npm prune --omit=dev

FROM node:26-bookworm-slim
ENV NODE_ENV=production
# tini as PID 1: the SIGTERM Nest re-raises would never end a node PID 1
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
# No WORKDIR: imageUploads/ resolves against /, where the image volume is mounted
RUN mkdir -p /imageUploads && chown node:node /imageUploads
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/vrt-entrypoint.sh
RUN chmod 755 /usr/local/bin/vrt-entrypoint.sh
EXPOSE 3000
# node without npm in between, so SIGTERM reaches the app's shutdown hooks
ENTRYPOINT [ "/usr/bin/tini", "--", "/usr/local/bin/vrt-entrypoint.sh" ]
CMD [ "node", "dist/main" ]
