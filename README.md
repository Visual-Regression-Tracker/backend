# Backend app for [Visual Regression Tracker](https://github.com/Visual-Regression-Tracker/Visual-Regression-Tracker)

## Local setup

- Install Node `24` (LTS), 24.15 or newer
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

## Running the test suites

| Suite | Command | Needs | Covers |
|---|---|---|---|
| unit | `npm test` | nothing | services with mocked dependencies (`src/**/*.spec.ts`) |
| e2e | `npm run test:e2e` | Postgres with the migrations applied (`DATABASE_URL`); run `npm run build` first | the app in-process against that database |
| acceptance | `npm run test:acceptance` | `docker compose up -d`; the API on `localhost:4200` | the running API over HTTP and socket.io |
| ldap | `npm run test:ldap` | `COMPOSE_FILE=docker-compose.yml:docker-compose.ldap.yml docker compose up -d` | LDAP login against the LDAP mock |
| oidc | `npm run test:oidc` | `COMPOSE_FILE=docker-compose.yml:docker-compose.oidc.yml docker compose up -d` | the OIDC endpoints against the OIDC mock |
| prisma package | `cd prisma && npm test` | `npm ci` in `prisma/` | the `prisma/` package's own tests |

The e2e suite loads the diff worker threads from `dist/`. Without a build they run
inline, so `npm run build` makes the e2e run match production.

Schema drift check (AGENTS.md: every schema change ships with its migration). Run it
against a database where the migrations are applied; exit code 2 means the schema has
changes without a migration:
```
cd prisma && npx prisma migrate deploy && npx prisma migrate diff --from-config-datasource --to-schema schema.prisma --exit-code
```

## Environment variables

Defaults are what the code uses when the variable is unset or empty. The commented
lines in `.env` (section `# optional`) show the same variables.

### Core

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_URL` | none, required | Postgres connection string. `connection_limit` sets the pool size per instance (see Database connections). |
| `APP_PORT` | `3000` | Port the API listens on. |
| `APP_FRONTEND_URL` | none | Frontend base URL, used to build links in test run results. |
| `BODY_PARSER_JSON_LIMIT` | body-parser default | Maximum JSON request body size, e.g. `5mb`. |
| `JWT_SECRET` | none, required | Key that signs login tokens; startup fails when it is unset. Public sample values (`jwtPrivateKey`, the one in `.env`) log a warning. Generate one with `openssl rand -hex 32`. |
| `JWT_LIFE_TIME` | `1d` | Token lifetime as a timespan such as `1d`, `12h` or `3600s`. An invalid value falls back to `1d` with a warning. |
| `SERVER_TIMEOUT` | Node.js default | HTTP `server.timeout`, in milliseconds. |
| `SERVER_HEADERS_TIMEOUT` | Node.js default | HTTP `headersTimeout`, in milliseconds. |
| `SERVER_KEEP_ALIVE_TIMEOUT` | Node.js default | HTTP `keepAliveTimeout`, in milliseconds. |
| `LOG_LEVEL` | all levels | Comma-separated Nest log levels to keep, e.g. `log,warn,error,fatal`. |
| `HTTPS_KEY_PATH` | `./secrets/ssl.key` | TLS private key. HTTPS is used only when both files exist; otherwise the API serves HTTP. |
| `HTTPS_CERT_PATH` | `./secrets/ssl.cert` | TLS certificate. |

### Storage

| Variable | Default | What it does |
|---|---|---|
| `STATIC_SERVICE` | `hdd` | Where images are stored: `hdd` (local disk) or `s3`. Odiff works only with `hdd`. |
| `AWS_S3_BUCKET_NAME` | none | Bucket for `STATIC_SERVICE=s3`; required then. |
| `AWS_REGION` | from the AWS SDK | Read by the AWS SDK v3 default chain, not by VRT code. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | from the AWS SDK | Same chain. An IAM role or shared AWS config works without them. |

### Image comparison

| Variable | Default | What it does |
|---|---|---|
| `MAX_IMAGE_PIXELS` | `100000000` | Largest accepted image in pixels (width times height), checked from the PNG header before decoding. `0` turns the limit off. |
| `MULTIPART_FILE_SIZE_LIMIT` | `104857600` (100 MiB) | Largest accepted multipart file upload, in bytes. |
| `DIFF_WORKERS_COUNT` | CPUs minus 1, between 1 and 8 | Number of diff worker threads. |
| `DIFF_QUEUE_LIMIT` | `256` | Diff jobs allowed to wait for a worker. When the queue is full the API answers `503` with `Retry-After: 5`. |
| `DIFF_WORKER_MAX_HEAP_MB` | `512` | Heap limit of each diff worker, in MB. |
| `OLLAMA_BASE_URL` | none | Ollama server for VLM comparisons; required when the Ollama provider is used. |
| `DINOV2_URL` | none | DINOv2 service for the `dinov2Check` noise filter. With the filter on and this unset, runs go to review. |
| `DINOV2_TIMEOUT_MS` | `60000` | Timeout for one DINOv2 request, in milliseconds. |

### Auth

| Variable | Default | What it does |
|---|---|---|
| `REGISTRATION_ENABLED` | `true` | `false` (also `0`, `no`, `off`) disables self-registration. |
| `LDAP_ENABLED` | `false` | Enables LDAP login. When OIDC is enabled too, OIDC is used. |
| `LDAP_URL` | none | LDAP server URL, e.g. `ldaps://ldap.example.com:636/`. Required when LDAP is enabled. |
| `LDAP_BIND_USER` | none | DN of the service account used for the user search. Required when LDAP is enabled. |
| `LDAP_BIND_PASSWORD` | none | Password of the service account. Required when LDAP is enabled. |
| `LDAP_SEARCH_DN` | none | Base DN of the user search. Required when LDAP is enabled. |
| `LDAP_USERS_SEARCH_FILTER` | none | User search filter; `{{email}}` is replaced by the login email. Required when LDAP is enabled. |
| `LDAP_ATTRIBUTE_MAIL`, `LDAP_ATTRIBUTE_FIRST_NAME`, `LDAP_ATTRIBUTE_LAST_NAME` | none | Attributes that hold the email, first name and last name. Required when LDAP is enabled. |
| `LDAP_TLS_NO_VERIFY` | `false` | Skip TLS certificate verification for LDAP. Test servers only. |
| `OIDC_ENABLED` | `false` | Enables OIDC (SSO) login; see the OIDC section. |
| `OIDC_ISSUER_URL` | none | Issuer URL of the identity provider. Required when OIDC is enabled. |
| `OIDC_CLIENT_ID` | none | OIDC client ID. Required when OIDC is enabled. |
| `OIDC_CLIENT_SECRET` | none | OIDC client secret. Required when OIDC is enabled. |
| `OIDC_REDIRECT_URI` | `http://localhost:4200/users/oidc/callback` | Callback URL registered at the identity provider. |
| `OIDC_SCOPES` | `openid profile email` | Requested scopes. |
| `OIDC_ATTRIBUTE_MAIL` | `email` | Claim that holds the email. |
| `OIDC_ATTRIBUTE_FIRST_NAME` | `given_name` | Claim that holds the first name. |
| `OIDC_ATTRIBUTE_LAST_NAME` | `family_name` | Claim that holds the last name. |
| `OIDC_ROLE_CLAIM` | `groups` | Claim, or dotted path, that holds the roles. |
| `OIDC_ADMIN_VALUES` | `vrt-admin,admin` | Comma-separated claim values that give the admin role. |
| `OIDC_DEFAULT_ROLE` | `editor` | Role for every other user: `admin` or `editor`. |
| `OIDC_REQUIRE_VERIFIED_EMAIL` | `true` | Reject logins whose email is not verified. |
| `OIDC_TLS_NO_VERIFY` | `false` | Skip TLS verification for the identity provider. Test servers only. |

### Service variables

| Variable | Default | What it does |
|---|---|---|
| `REDIS_URL` | unset, in-memory adapter | Redis for socket.io fan-out between instances (see Scaling to multiple instances). |

### Seed

Read by `prisma db seed`.

| Variable | Default | What it does |
|---|---|---|
| `DEFAULT_USER_EMAIL` | `visual-regression-tracker@example.com` | Email of the default user. |
| `DEFAULT_USER_PASSWORD` | generated, printed once | Password of the default user. |
| `DEFAULT_USER_API_KEY` | generated, printed once | API key of the default user. |

## Optional services

- **Redis** runs several API instances behind one socket.io fan-out. Set `REDIS_URL`; see [Scaling to multiple instances](#scaling-to-multiple-instances-real-time-updates).
- **DINOv2** serves the `dinov2Check` rendering-noise filter (see `dinov2/README.md`). Start it with `docker compose --profile dinov2 up -d`. The service listens on port 8000 inside the compose network only, so the API container uses `DINOV2_URL=http://dinov2:8000`.
- **Ollama** runs the VLM comparison locally. Set `OLLAMA_BASE_URL`; from the API container, which is started by compose, the host is `http://host.docker.internal:11434`.
- **Gemini** runs the VLM comparison in the cloud. Its API key is set in the project's VLM settings, not in the environment.

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
