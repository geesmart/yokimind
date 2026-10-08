-- rag_chunks 按 PGVectorStore 结构重建，旧向量数据弃用；
-- 置空指纹并重置 pending，worker 启动自愈（recoverStaleTasks 重新入队）后全量重索引
UPDATE rag_sync SET content_hash = NULL, status = 'pending';
DROP TABLE "rag_chunks" CASCADE;