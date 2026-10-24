FROM node:24-bookworm-slim AS builder
# Create app directory
WORKDIR /app

COPY prisma.config.ts ./
COPY ./prisma/schema.prisma ./prisma/

# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install app dependencies
ENV NODE_TLS_REJECT_UNAUTHORIZED='0'
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src

# Dev dependencies are only needed to build; the generated Prisma client
# under node_modules/.prisma survives the prune
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production
# No WORKDIR: the app resolves imageUploads/ against /, where deployments
# mount the image volume
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
EXPOSE 3000
# node itself as PID 1 so SIGTERM reaches the app's shutdown hooks
CMD [ "node", "dist/main" ]
