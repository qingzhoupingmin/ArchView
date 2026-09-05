-- 数据隔离专项（批次 B/D）
-- AlterTable：工程乐观锁版本号（S9：多端全量覆盖互相吞改动的收口）
ALTER TABLE "Project" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable：操作日志（FR-U09；串号事故可追溯 —— 谁读过 / 改过谁的工程）
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "ip" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
