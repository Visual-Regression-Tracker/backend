FROM node:24-bookworm-slim

WORKDIR /app

COPY . .

ENV NODE_TLS_REJECT_UNAUTHORIZED='0'
RUN npm ci

RUN chmod +x /app/wait-for-it.sh
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
