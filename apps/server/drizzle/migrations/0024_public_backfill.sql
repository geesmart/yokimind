-- 数据回填：存量「已公开但无发布配置行」的库补建 wiki_publish 行（enabled = true）
-- 背景：旧版发布/公开动作只写 wiki_shares 库级行（node_id=''、share_status='public'），
-- 不创建 wiki_publish 行（或库在 wiki_publish 表 0019 引入之前就已是公开态）。
-- 新语义下发布态唯一数据源是 wiki_publish.enabled（Dashboard「已发布」徽标与编辑器
-- 顶栏 isPublishedWiki 都取它），无配置行的库会被误判为「仅分享」（Globe 图标）。
-- 按用户视角「已公开即发布过」统一回填为已发布，保持语义连续。
-- - id 复用原库级行 id（0019 之后创建的库级行 id 未在 wiki_publish 出现过，主键安全）
-- - publish_type 固定 'help'（旧数据无站点形态概念，帮助中心为默认形态）
-- - ON CONFLICT DO NOTHING 同时兜底主键与 wiki_id 唯一索引冲突，可重复执行（幂等）
INSERT INTO "wiki_publish" ("id", "wiki_id", "publish_type", "enabled", "settings", "created_by", "created_at", "updated_at")
SELECT
  s."id",
  s."wiki_id",
  'help',
  true,
  '{}'::jsonb,
  s."created_by",
  now(),
  now()
FROM "wiki_shares" s
WHERE s."node_id" = '' AND s."share_status" = 'public'
ON CONFLICT DO NOTHING;
