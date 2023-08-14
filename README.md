# Backend app for [Visual Regression Tracker](https://github.com/Visual-Regression-Tracker/Visual-Regression-Tracker)

[![Codacy Badge](https://app.codacy.com/project/badge/Grade/7d43b68b39cd41aa830120371be736ad)](https://www.codacy.com/gh/Visual-Regression-Tracker/backend?utm_source=github.com&utm_medium=referral&utm_content=Visual-Regression-Tracker/backend&utm_campaign=Badge_Grade)
[![Codacy Badge](https://app.codacy.com/project/badge/Coverage/7d43b68b39cd41aa830120371be736ad)](https://www.codacy.com/gh/Visual-Regression-Tracker/backend?utm_source=github.com&utm_medium=referral&utm_content=Visual-Regression-Tracker/backend&utm_campaign=Badge_Coverage)

## Local setup

- Install Node `18` (LTS)
- clone repo
- Update `.env` and `prisma/.env`
- Make sure Postgres is up and running, using `docker-compose up` in a separate terminal
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