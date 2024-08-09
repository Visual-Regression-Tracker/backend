FROM node:18-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt update && apt install -y libssl3 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

RUN npm ci --verbose

RUN chmod +x /app/wait-for-it.sh
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]

CMD ["sh"]