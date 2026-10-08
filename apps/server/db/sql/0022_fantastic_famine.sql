-- 存量回填：把旧 deleted_at 时间戳承载的"在回收站中"状态迁移到 is_deleted 布尔标记
-- （必须在 DROP COLUMN deleted_at 之前执行）
UPDATE "wiki_nodes" SET "is_deleted" = true WHERE "deleted_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_nodes" DROP COLUMN "deleted_at";