# Backend app for [Visual Regression Tracker](https://github.com/Visual-Regression-Tracker/Visual-Regression-Tracker)

[![Codacy Badge](https://app.codacy.com/project/badge/Grade/7d43b68b39cd41aa830120371be736ad)](https://www.codacy.com/gh/Visual-Regression-Tracker/backend?utm_source=github.com&utm_medium=referral&utm_content=Visual-Regression-Tracker/backend&utm_campaign=Badge_Grade)
[![Codacy Badge](https://app.codacy.com/project/badge/Coverage/7d43b68b39cd41aa830120371be736ad)](https://www.codacy.com/gh/Visual-Regression-Tracker/backend?utm_source=github.com&utm_medium=referral&utm_content=Visual-Regression-Tracker/backend&utm_campaign=Badge_Coverage)

## Local setup

- clone repo
- Update `.env` and `prisma/.env`
- Make sure Postgres is up and running
- `npm i`
- `npm run test`
- Create DB structure and apply migrations `npx prisma migrate up -c --experimental`
- `npm run test:e2e`
- Seed initial data `npx ts-node prisma/seed.ts`
- `npm run start:debug`

## Local HTTPS config

- Generate keys [here](https://www.selfsignedcertificate.com/)
- place in folder `/secrets` named `ssl.cert` and `ssl.key`