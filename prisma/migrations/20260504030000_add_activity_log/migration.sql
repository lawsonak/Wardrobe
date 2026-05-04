-- Per-user activity log, surfaced on the Settings page. Logs CRUD writes,
-- AI invocations, and sign-ins so each profile can see a chronological
-- record of their own usage. Strictly per-user — no cross-profile reads.
-- Auto-pruned to ~90 days by lib/activity.ts every time a new row is written.

CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ActivityLog_userId_createdAt_idx" ON "ActivityLog"("userId", "createdAt");
