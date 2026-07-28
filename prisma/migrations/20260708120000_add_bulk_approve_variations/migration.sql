-- AlterTable
ALTER TABLE "Project" ADD COLUMN "bulkApproveVariations" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN "bulkApproveGroupBy" TEXT NOT NULL DEFAULT 'customTags';
