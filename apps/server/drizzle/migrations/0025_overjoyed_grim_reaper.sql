CREATE TABLE "wiki_rag" (
	"id" text PRIMARY KEY NOT NULL,
	"wiki_id" text NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"pending" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_rag_wiki_uniq" ON "wiki_rag" USING btree ("wiki_id");
--> statement-breakpoint
-- 存量数据回填：按 wiki_id 聚合 rag_sync 生成初始快照
-- （计数口径与 rag.service.ts statusOf 一致：pending = pending + running；
--   id 用 uuid 去横线模拟 ULID 格式，纯 SQL 不依赖 Qdrant，chunkCount 用 rag_sync.chunk_count 求和）
-- ON CONFLICT DO NOTHING 保证幂等，可重复执行
INSERT INTO "wiki_rag" ("id", "wiki_id", "total", "done", "pending", "failed", "chunk_count", "last_synced_at")
SELECT
  replace(gen_random_uuid()::text, '-', ''),
  "wiki_id",
  count(*)::int,
  count(*) FILTER (WHERE "status" = 'done')::int,
  count(*) FILTER (WHERE "status" IN ('pending', 'running'))::int,
  count(*) FILTER (WHERE "status" = 'failed')::int,
  coalesce(sum("chunk_count"), 0)::int,
  max("last_synced_at")
FROM "rag_sync"
GROUP BY "wiki_id"
ON CONFLICT ("wiki_id") DO NOTHING;