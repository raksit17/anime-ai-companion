CREATE TABLE "PlannerActivityEvent" (
  "id" TEXT NOT NULL,
  "plannerId" TEXT NOT NULL DEFAULT 'local',
  "sessionId" TEXT NOT NULL,
  "activityKey" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "before" JSONB,
  "after" JSONB,
  CONSTRAINT "PlannerActivityEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlannerActivityEvent_plannerId_occurredAt_idx"
  ON "PlannerActivityEvent" ("plannerId", "occurredAt");
CREATE INDEX "PlannerActivityEvent_plannerId_activityKey_occurredAt_idx"
  ON "PlannerActivityEvent" ("plannerId", "activityKey", "occurredAt");
CREATE INDEX "PlannerActivityEvent_plannerId_sessionId_idx"
  ON "PlannerActivityEvent" ("plannerId", "sessionId");
