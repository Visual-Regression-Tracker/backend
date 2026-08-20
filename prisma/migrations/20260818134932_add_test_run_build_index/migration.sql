-- CreateIndex
-- Single statement on purpose: Prisma runs one-statement migrations outside a
-- transaction, which CREATE INDEX CONCURRENTLY requires. Concurrent build
-- avoids write-locking TestRun on large production tables.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "TestRun_buildId_branchName_name_idx" ON "TestRun"("buildId", "branchName", "name");
