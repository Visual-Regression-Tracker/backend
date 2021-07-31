FROM node:12-alpine AS builder

# Create app directory
WORKDIR /app

RUN npm install -g @prisma/cli@2.12.1 --unsafe-perm

COPY ./prisma/schema.prisma ./

# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install app dependencies
RUN npm install

COPY tsconfig*.json ./
COPY src ./src

RUN npm run build

# TODO use node-alpine when supported by prisma2 https://github.com/prisma/prisma2/issues/702
FROM node:12.18.4-alpine
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD [ "npm", "run", "start:prod" ]