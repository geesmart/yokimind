-- 注：此迁移最初重建 rag_chunks 时依赖 pgvector（embedding vector 列 + hnsw 索引），
-- 已随 RAG 迁移 Qdrant 剥离 pgvector 依赖（0017 删表），官方 postgres 镜像可执行
CREATE TABLE "rag_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content" text,
	"metadata" jsonb
);
--> statement-breakpoint
-- metadata 表达式索引：检索按库过滤（similaritySearch filter）与按文档删除走 jsonb 字段，drizzle-kit 不管理表达式索引
CREATE INDEX IF NOT EXISTS rag_chunks_metadata_wiki_id_idx ON rag_chunks ((metadata->>'wikiId'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rag_chunks_metadata_document_id_idx ON rag_chunks ((metadata->>'documentId'));