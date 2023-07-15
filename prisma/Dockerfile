# https://github.com/Visual-Regression-Tracker/Visual-Regression-Tracker/issues/137
FROM node:14-alpine3.17

RUN apk add --no-cache bash

WORKDIR /app

COPY . .

RUN npm ci 

RUN chmod +x /app/wait-for-it.sh
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]

CMD ["sh"]