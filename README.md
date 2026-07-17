# Backend app for [Visual Regression Tracker](https://github.com/Visual-Regression-Tracker/Visual-Regression-Tracker)

[![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=Visual-Regression-Tracker_backend&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=Visual-Regression-Tracker_backend)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=Visual-Regression-Tracker_backend&metric=coverage)](https://sonarcloud.io/summary/new_code?id=Visual-Regression-Tracker_backend)

## Local setup

- Install Node `18` (LTS)
- clone repo
- Update `.env` and `prisma/.env`
- Make sure Postgres is up and running, using `docker compose up` in a separate terminal
- `npm i`
- `npm run test`
- Create DB structure `npx prisma db push`
- Apply migrations `npx prisma migrate deploy`
- `npm run test:e2e`
- Seed initial data `npx prisma db seed`
- `npm run start:debug`

## Scaling to multiple instances (real-time updates)

Real-time UI updates are delivered over socket.io. Running **more than one API
instance** requires **both** of the following — with only one, live updates
break:

1. **Redis backplane** — set `REDIS_URL` so every instance shares a socket.io
   pub/sub adapter. Without it, an event emitted on one instance never reaches
   clients connected to another (events are silently lost and the UI only
   updates after a manual refresh).
   ```
   REDIS_URL=redis://<host>:6379
   ```
   When `REDIS_URL` is unset, the default in-memory adapter is used, so a single
   instance and local development work with no extra setup.

2. **Reverse proxy with sticky sessions + WebSocket upgrade** for `/socket.io/`.
   Without sticky sessions the polling handshake fails with `400 "Session ID
   unknown"` because consecutive requests land on different instances. Example
   nginx:
   ```nginx
   map $http_upgrade $connection_upgrade { default upgrade; '' close; }

   upstream vrt_api {
     ip_hash;                 # sticky sessions
     server api_1:3000;
     server api_2:3000;
   }

   location /socket.io/ {
     proxy_pass http://vrt_api;
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection $connection_upgrade;
     proxy_set_header Host $host;
     proxy_read_timeout 3600s;
   }
   ```

Confirmed with a 4-replica deployment: nginx `ip_hash` + WebSocket upgrade fixes
the handshake, but cross-replica event delivery still requires `REDIS_URL`.

## Local HTTPS config

- Generate keys [here](https://www.selfsignedcertificate.com/)
- place in folder `/secrets` named `ssl.cert` and `ssl.key`

## Local LDAP test server

- Run `docker compose -f docker-compose.yml -f docker-compose.ldap.yml ` (see [docker docs for multiple-compose-files - merge](https://docs.docker.com/compose/multiple-compose-files/merge/))
- test the login with ldap and have a look at the logs
    ```sh
    curl 'http://localhost:4200/users/login' \
    -H 'accept: */*' \
    -H 'accept-language: de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7,fr;q=0.6' \
    -H 'content-type: application/json' \
    --data-raw '{"email":"developer.one@ldapmock.local","password":"password"}'
    ```