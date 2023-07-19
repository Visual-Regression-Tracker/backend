# https://github.com/Visual-Regression-Tracker/Visual-Regression-Tracker/issues/137
FROM node:18-alpine3.18

RUN apk add --no-cache bash

WORKDIR /app

COPY . .

RUN npm ci --verbose

RUN chmod +x /app/wait-for-it.sh
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]

CMD ["sh"]