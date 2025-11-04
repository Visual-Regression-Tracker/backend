FROM node:20-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt update && apt install -y libssl3 && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY . ./prisma

WORKDIR /workspace/prisma

ENV NODE_TLS_REJECT_UNAUTHORIZED='0'
RUN npm ci --verbose && \
    chmod +x /workspace/prisma/wait-for-it.sh && \
    chmod +x /workspace/prisma/entrypoint.sh

ENTRYPOINT ["/workspace/prisma/entrypoint.sh"]

CMD ["sh"]