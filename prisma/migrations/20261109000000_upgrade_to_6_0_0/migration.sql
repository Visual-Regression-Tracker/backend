-- Guarded so databases that ran the 6.0.0 release candidates' migrations upgrade in place.

-- AlterTable
ALTER TABLE "Baseline" ADD COLUMN IF NOT EXISTS "commentBeforeApproval" TEXT,
ADD COLUMN IF NOT EXISTS "ignoreAreasBeforeApproval" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "noiseAnalysisConfig" TEXT NOT NULL DEFAULT '{"blur":{"enabled":false,"amplitudeThreshold":80,"solidShareMax":0.01},"dinov2":{"enabled":false,"distanceThreshold":0.15}}';
ALTER TABLE "Project" ALTER COLUMN "noiseAnalysisConfig" SET DEFAULT '{"blur":{"enabled":false,"amplitudeThreshold":80,"solidShareMax":0.01},"dinov2":{"enabled":false,"distanceThreshold":0.15}}';

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN IF NOT EXISTS "noiseAnalysis" JSONB,
ADD COLUMN IF NOT EXISTS "statusBeforeDecision" "TestStatus";

-- CreateTable
CREATE TABLE IF NOT EXISTS "_UserFavoriteProjects" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_UserFavoriteProjects_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "_UserFavoriteProjects_B_index" ON "_UserFavoriteProjects"("B");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"_UserFavoriteProjects"'::regclass AND conname = '_UserFavoriteProjects_A_fkey') THEN
    ALTER TABLE "_UserFavoriteProjects" ADD CONSTRAINT "_UserFavoriteProjects_A_fkey" FOREIGN KEY ("A") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"_UserFavoriteProjects"'::regclass AND conname = '_UserFavoriteProjects_B_fkey') THEN
    ALTER TABLE "_UserFavoriteProjects" ADD CONSTRAINT "_UserFavoriteProjects_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
