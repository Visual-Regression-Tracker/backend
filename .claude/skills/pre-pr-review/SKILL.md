---
name: pre-pr-review
description: Review a branch before its pull request is opened or updated. Use whenever a PR or merge request is about to be created, pushed or marked ready, or the user asks "can we open the PR", "make a PR", "push this", even when they do not mention a review.
---

# Before a pull request

No pull request is opened, and no branch is pushed for one, until these steps
pass. A step that fails is fixed on the branch, not noted for later.

1. **Checks.** `npm run typecheck`, `npm run lint`, `npm run format:check`,
   `npm run test:cov`, `npm run build`, and `npm run test:e2e` against a
   database of its own (`docker run -d --name vrt-e2e-pr -e POSTGRES_PASSWORD=pg
   -p 55499:5432 postgres:15.3-alpine3.18`, then with
   `DATABASE_URL=postgresql://postgres:pg@localhost:55499/postgres`:
   `npx prisma migrate deploy`, `npx prisma migrate diff --from-config-datasource
   --to-schema prisma/schema.prisma --exit-code`, `npm run test:e2e`; remove it
   with `docker rm -fv vrt-e2e-pr`). If the branch touches the Dockerfiles,
   compose files, the seed or auth, also bring the stack up with
   `docker compose up --build`, check `/health`, run `npm run test:acceptance`
   (and `test:ldap` / `test:oidc` with their compose overlays when auth
   changed), then `docker compose down --volumes`. If `dinov2/` changed, run
   `python -m unittest test_patches` there.
2. **Code review.** Run the `code-review` skill on the branch against its base
   (`master` unless the PR targets another branch), at `high` effort or above
   for a branch of more than a few commits. Fix every confirmed finding on the
   branch; for a finding left as is, say why in the PR description.
3. **Comments.** Go through the diff's comments with the rule in `AGENTS.md`
   (Code conventions, "Comments"): delete any that restate the code, narrate
   history, point at review notes or ids that are not in the repo, or would
   not change what a reader does. Keep only non-obvious whys, one line each.
   Test names follow the same rule.
4. **Plan status.** If the branch works through a plan in `docs/`, tick the
   done tasks there and record follow-ups.
5. **Commits.** Author is the repo's configured git identity; no
   `Co-Authored-By` or "Generated with" lines.

Then open the PR. Its description lists what changed by area, how it was
verified (the commands above and their results), what needs attention when
deploying (migrations, new or changed environment variables, behaviour
changes), and what is deliberately left for later.
