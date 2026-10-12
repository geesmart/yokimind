-- 数据迁移：清理存量页面级 'private' 分享行（旧模型「从公开库隐藏页面」的覆盖行）
-- 新权限模型下页面分享仅两态：public（单独公开，库分享关闭时生效）/ 无行（未分享）；
-- 页面级 'private' 不再有语义，保留会导致 owner 弹窗回显与文档树分享 icon 异常，故直接删除
DELETE FROM "wiki_shares" WHERE "node_id" <> '' AND "share_status" = 'private';
