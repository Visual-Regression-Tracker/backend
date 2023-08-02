# https://github.com/Visual-Regression-Tracker/Visual-Regression-Tracker/issues/137
FROM node:18-alpine3.18 AS builder

# Create app directory
WORKDIR /app

COPY ./prisma/schema.prisma ./

# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install app dependencies
RUN npm ci --verbose

COPY tsconfig*.json ./
COPY src ./src

RUN npm run build

# https://github.com/Visual-Regression-Tracker/Visual-Regression-Tracker/issues/137
FROM node:18-alpine3.18
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD [ "npm", "run", "start:prod" ]