-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "noiseAnalysisConfig" TEXT NOT NULL DEFAULT '{"blur":{"enabled":true,"amplitudeThreshold":80,"solidShareMax":0.01},"dinov2":{"enabled":true,"distanceThreshold":0.15}}';
