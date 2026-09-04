-- AlterTable
-- Nullable with no default, so this is a catalogue-only change on Postgres 11+:
-- no table rewrite and no long lock. Existing rows keep NULL and the UI falls
-- back to the full-size image for them.
ALTER TABLE "TestRun" ADD COLUMN "imageThumbnailName" TEXT,
                      ADD COLUMN "diffThumbnailName" TEXT;
