-- AlterTable
-- Nullable with no default, so this is a catalogue-only change on Postgres 11+:
-- no table rewrite and no long lock, which matters on a TestRun table holding
-- a hundred builds' worth of runs. Existing rows keep NULL and fall back to
-- computing the signature on demand.
ALTER TABLE "TestRun" ADD COLUMN "changeSignature" TEXT;
