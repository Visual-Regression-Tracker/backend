-- CreateIndex
-- Single statement on purpose: Prisma runs one-statement migrations outside a
-- transaction, which CREATE INDEX CONCURRENTLY requires. Concurrent build
-- avoids write-locking Baseline on large production tables.
--
-- Deliberately without IF NOT EXISTS: a concurrent build that fails leaves an
-- invalid index behind, and skipping it on a retry would let the migration
-- succeed while the index stays unusable. Drop the invalid index, then retry.
CREATE INDEX CONCURRENTLY "Baseline_testVariationId_createdAt_idx" ON "Baseline"("testVariationId", "createdAt");
