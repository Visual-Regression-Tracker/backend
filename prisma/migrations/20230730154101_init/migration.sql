-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('failed', 'new', 'ok', 'unresolved', 'approved', 'autoApproved');

-- CreateEnum
CREATE TYPE "ImageComparison" AS ENUM ('pixelmatch', 'lookSame', 'odiff');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'editor', 'guest');

-- CreateTable
CREATE TABLE "Build" (
    "id" TEXT NOT NULL,
    "ciBuildId" TEXT,
    "number" INTEGER,
    "branchName" TEXT,
    "status" TEXT,
    "projectId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "isRunning" BOOLEAN,

    CONSTRAINT "Build_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mainBranchName" TEXT NOT NULL DEFAULT 'master',
    "buildsCounter" INTEGER NOT NULL DEFAULT 0,
    "maxBuildAllowed" INTEGER NOT NULL DEFAULT 100,
    "maxBranchLifetime" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "autoApproveFeature" BOOLEAN NOT NULL DEFAULT true,
    "imageComparison" "ImageComparison" NOT NULL DEFAULT 'pixelmatch',
    "imageComparisonConfig" TEXT NOT NULL DEFAULT '{ "threshold": 0.1, "ignoreAntialiasing": true, "allowDiffDimensions": false }',

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRun" (
    "id" TEXT NOT NULL,
    "imageName" TEXT NOT NULL,
    "diffName" TEXT,
    "diffPercent" DOUBLE PRECISION,
    "diffTollerancePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pixelMisMatchCount" INTEGER,
    "status" "TestStatus" NOT NULL,
    "buildId" TEXT NOT NULL,
    "testVariationId" TEXT,
    "projectId" TEXT,
    "merge" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL DEFAULT '',
    "browser" TEXT,
    "device" TEXT,
    "os" TEXT,
    "viewport" TEXT,
    "customTags" TEXT DEFAULT '',
    "baselineName" TEXT,
    "comment" TEXT,
    "branchName" TEXT NOT NULL DEFAULT 'master',
    "baselineBranchName" TEXT,
    "ignoreAreas" TEXT NOT NULL DEFAULT '[]',
    "tempIgnoreAreas" TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestVariation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branchName" TEXT NOT NULL DEFAULT 'master',
    "browser" TEXT NOT NULL DEFAULT '',
    "device" TEXT NOT NULL DEFAULT '',
    "os" TEXT NOT NULL DEFAULT '',
    "viewport" TEXT NOT NULL DEFAULT '',
    "customTags" TEXT NOT NULL DEFAULT '',
    "baselineName" TEXT,
    "ignoreAreas" TEXT NOT NULL DEFAULT '[]',
    "projectId" TEXT NOT NULL,
    "comment" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestVariation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Baseline" (
    "id" TEXT NOT NULL,
    "baselineName" TEXT NOT NULL,
    "testVariationId" TEXT NOT NULL,
    "testRunId" TEXT,
    "userId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Baseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "apiKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "role" "Role" NOT NULL DEFAULT 'guest',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Build_projectId_ciBuildId_key" ON "Build"("projectId", "ciBuildId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_name_key" ON "Project"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TestVariation_projectId_name_browser_device_os_viewport_cus_key" ON "TestVariation"("projectId", "name", "browser", "device", "os", "viewport", "customTags", "branchName");

-- CreateIndex
CREATE UNIQUE INDEX "Baseline_testRunId_key" ON "Baseline"("testRunId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_apiKey_key" ON "User"("apiKey");

-- AddForeignKey
ALTER TABLE "Build" ADD CONSTRAINT "Build_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Build" ADD CONSTRAINT "Build_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "Build"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_testVariationId_fkey" FOREIGN KEY ("testVariationId") REFERENCES "TestVariation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestVariation" ADD CONSTRAINT "TestVariation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Baseline" ADD CONSTRAINT "Baseline_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Baseline" ADD CONSTRAINT "Baseline_testVariationId_fkey" FOREIGN KEY ("testVariationId") REFERENCES "TestVariation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Baseline" ADD CONSTRAINT "Baseline_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
