FROM node:26-bookworm-slim

WORKDIR /app

COPY . .

RUN npm ci

RUN chmod +x /app/wait-for-it.sh
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
