FROM node:12-alpine

RUN apk add --no-cache bash

WORKDIR /app

COPY . .

RUN npm ci 

RUN chmod +x /app/wait-for-it.sh
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]

CMD ["sh"]