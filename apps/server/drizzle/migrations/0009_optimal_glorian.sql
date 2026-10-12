-- 注：此迁移最初创建 rag_chunks 时依赖 pgvector（embedding vector 列 + hnsw 索引）。
-- RAG 向量层后已迁移至 Qdrant（0017 删表），官方 postgres 镜像不再需要 vector 扩展，
-- 故历史 SQL 已剥离全部 pgvector 依赖，全新环境可直接在官方 postgres:17-alpine 上执行。

CREATE TABLE "rag_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"wiki_id" text NOT NULL,
	"node_id" text,
	"chunk_index" integer NOT NULL,
	"heading_path" text,
	"content" text NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_sync" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"wiki_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"content_hash" text,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rag_sync_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
CREATE INDEX "rag_chunks_wiki_id_idx" ON "rag_chunks" USING btree ("wiki_id");--> statement-breakpoint
CREATE INDEX "rag_chunks_document_id_idx" ON "rag_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "rag_sync_status_idx" ON "rag_sync" USING btree ("status","attempts");--> statement-breakpoint
CREATE INDEX "rag_sync_wiki_id_idx" ON "rag_sync" USING btree ("wiki_id");