-- AlterTable
ALTER TABLE "Project" ALTER COLUMN "noiseAnalysisConfig" SET DEFAULT '{"blur":{"enabled":false,"amplitudeThreshold":80,"solidShareMax":0.01},"dinov2":{"enabled":false,"distanceThreshold":0.15}}';
