-- =====================================================================
-- 前置依赖：执行本迁移前必须先运行回填脚本
--   pnpm --filter @yokimind/server tsx scripts/backfill-folder-documents.ts
-- 该脚本为原文件夹节点（is_folder=true 且 document_id IS NULL）补建空 documents 行
-- 否则下一行 SET NOT NULL 会因存在 NULL 值而失败
-- =====================================================================
ALTER TABLE "wiki_nodes" ALTER COLUMN "document_id" SET NOT NULL;--> statement-breakpoint
-- default_home_doc_id 为历史遗留字段，schema.ts 早已移除，此处顺带清理
ALTER TABLE "wiki" DROP COLUMN "default_home_doc_id";--> statement-breakpoint
ALTER TABLE "wiki_nodes" DROP COLUMN "is_folder";