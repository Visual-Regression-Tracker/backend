# Backend app for [Visual Regression Tracker](https://github.com/Visual-Regression-Tracker/Visual-Regression-Tracker)

## Local setup

- Install Node `20` (LTS) or newer
- clone repo
- Update `.env` and `prisma/.env` (`DATABASE_URL` in `prisma/.env` must match the `POSTGRES_*` values in `.env`)
- Start Postgres `docker compose up -d postgres`
- `npm i`
- `npm run test`
- Create DB structure `npx prisma migrate deploy`
  - do not run `npx prisma db push` before it: `db push` creates the tables without the migration history, so `migrate deploy` then fails with `P3005 The database schema is not empty`. If that already happened, start over with an empty database (`docker compose down -v`)
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

### Database connections

Each API instance keeps one Prisma connection pool. By default it opens up to
`num_physical_cpus * 2 + 1` connections, and idle connections stay open for
reuse. Size the pool with the `connection_limit` parameter of `DATABASE_URL` so
that `replicas * connection_limit` stays below Postgres `max_connections`
(default 100), leaving room for migrations and admin tools:
```
DATABASE_URL=postgresql://user:password@postgres:5432/vrt?connection_limit=10
```

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

## OIDC (SSO)

Set `OIDC_ENABLED=true` and the `OIDC_*` variables in `.env`. Password login and registration are disabled while OIDC is enabled.

- **Roles come from the identity provider.** On every login the role is derived from `OIDC_ROLE_CLAIM`: `admin` when a value matches `OIDC_ADMIN_VALUES`, otherwise `OIDC_DEFAULT_ROLE`. Roles assigned in the VRT UI are overwritten at the next login. When the claim is missing from the token, an existing user keeps their role.
- `OIDC_ROLE_CLAIM` accepts a claim name or a dotted path into nested claims, e.g. `realm_access.roles` for Keycloak realm roles.
- **Accounts are matched by email.** The first login creates the user, later logins find them by the email claim. If a user's email changes at the identity provider, a new VRT account is created. Unverified emails are rejected unless `OIDC_REQUIRE_VERIFIED_EMAIL=false`.

## Local OIDC test server

- Run `docker compose -f docker-compose.yml -f docker-compose.oidc.yml up` (see [docker docs for multiple-compose-files - merge](https://docs.docker.com/compose/multiple-compose-files/merge/))
- The issuer (`host.docker.internal:8090`) must be reachable from both the api container and the browser. On macOS/Windows Docker Desktop this works out of the box; on Linux add `127.0.0.1 host.docker.internal` to `/etc/hosts`.
- Open `http://localhost:8080/login` and click **Login with SSO** (or set `REACT_APP_OIDC_AUTO_REDIRECT=true` to redirect straight away).
- Mock users: username `admin` (role `admin`), any other username (role `editor`). The password is ignored. See `oauth2-mock-server-config.json`.
- Optional: inspect/trigger the flow manually via the debugger at `http://host.docker.internal:8090/default/debugger`.
- Verify the OIDC endpoints (api must run with OIDC enabled) and run the integration tests:
    ```sh
    curl -i 'http://localhost:4200/users/oidc/enabled'
    curl -i 'http://localhost:4200/users/oidc/login'
    npm run test:oidc
    ```
