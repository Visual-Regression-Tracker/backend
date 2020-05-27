FROM node:12-alpine

WORKDIR /app

COPY . .

RUN npm ci 

RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]

CMD ["sh"]