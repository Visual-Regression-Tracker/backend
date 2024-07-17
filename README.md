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