-- AlterEnum
ALTER TYPE "ImageComparison" ADD VALUE 'vlm';

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN "vlmDescription" TEXT;

