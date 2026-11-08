FROM node:26-bookworm-slim

WORKDIR /app

COPY . .

RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

RUN npm ci

RUN chmod +x /app/wait-for-it.sh
RUN chmod +x /app/entrypoint.sh

USER 1000:1000

ENTRYPOINT ["/app/entrypoint.sh"]
